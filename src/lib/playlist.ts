// S11 — Playlists : règles d'appartenance (client-safe).

export type PlaylistRules = {
  cpe: string[];
  communes: string[];
  configIds: number[];
  match: "all" | "any"; // combinaison des groupes (cpe / commune / recherche)
};

export type Playlist = {
  id: number;
  name: string;
  rules: PlaylistRules;
  includes: string[]; // biens ajoutés manuellement (hors règles)
  excludes: string[]; // biens retirés manuellement (malgré les règles)
};

export const EMPTY_RULES: PlaylistRules = { cpe: [], communes: [], configIds: [], match: "all" };

export function normalizeRules(r: any): PlaylistRules {
  return {
    cpe: Array.isArray(r?.cpe) ? r.cpe : [],
    communes: Array.isArray(r?.communes) ? r.communes : [],
    configIds: Array.isArray(r?.configIds) ? r.configIds : [],
    match: r?.match === "any" ? "any" : "all",
  };
}

export function rulesAreEmpty(r: PlaylistRules): boolean {
  return r.cpe.length === 0 && r.communes.length === 0 && r.configIds.length === 0;
}

type ListingLike = {
  id: string;
  cpe?: string | null;
  commune?: string | null;
  matchedConfigIds?: number[];
};

/** Le bien satisfait-il les règles auto de la playlist ? */
export function matchesRules(l: ListingLike, rules: PlaylistRules): boolean {
  const groups: boolean[] = [];
  if (rules.cpe.length) groups.push(rules.cpe.includes(l.cpe || ""));
  if (rules.communes.length) groups.push(rules.communes.includes(l.commune || ""));
  if (rules.configIds.length)
    groups.push((l.matchedConfigIds || []).some((id) => rules.configIds.includes(id)));
  if (groups.length === 0) return false; // règles vides => uniquement les ajouts manuels
  return rules.match === "any" ? groups.some(Boolean) : groups.every(Boolean);
}

/** Le bien fait-il partie de la playlist (règles + surcharges manuelles) ? */
export function isInPlaylist(l: ListingLike, p: Playlist): boolean {
  if (p.excludes.includes(l.id)) return false;
  if (p.includes.includes(l.id)) return true;
  return matchesRules(l, p.rules);
}

/** Quelle surcharge écrire pour basculer l'appartenance manuelle d'un bien. */
export function toggleKind(l: ListingLike, p: Playlist): "include" | "exclude" | "none" {
  const matched = matchesRules(l, p.rules);
  const currentlyIn = isInPlaylist(l, p);
  if (currentlyIn) return matched ? "exclude" : "none"; // retirer
  return matched ? "none" : "include"; // ajouter
}
