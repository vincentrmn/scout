// S11 — Filtrage des biens suivis (logique partagée Suivis + Playlists).
// Tout est client-safe (aucune dépendance DB).

export type TrackedFilter = {
  cpe: string[];        // classes CPE retenues (OR entre elles)
  communes: string[];   // communes/quartiers retenus (OR)
  statuses: string[];   // follow_status retenus (OR)
  marginMin: number | null;
  priceMin: number | null;
  priceMax: number | null;
  text: string;
};

export const EMPTY_FILTER: TrackedFilter = {
  cpe: [],
  communes: [],
  statuses: [],
  marginMin: null,
  priceMin: null,
  priceMax: null,
  text: "",
};

export type FilterableListing = {
  id: string;
  title?: string;
  cpe?: string | null;
  commune?: string | null;
  follow_status?: string;
  marginPct?: number | null;
  price: number;
  address?: string | null;
};

/** Nombre de critères actifs (pour le badge du bouton Filtres). */
export function activeFilterCount(f: TrackedFilter): number {
  let n = 0;
  if (f.cpe.length) n++;
  if (f.communes.length) n++;
  if (f.statuses.length) n++;
  if (f.marginMin != null) n++;
  if (f.priceMin != null) n++;
  if (f.priceMax != null) n++;
  if (f.text.trim()) n++;
  return n;
}

export function matchesFilter(l: FilterableListing, f: TrackedFilter): boolean {
  if (f.cpe.length && !f.cpe.includes(l.cpe || "")) return false;
  if (f.communes.length && !f.communes.includes(l.commune || "")) return false;
  if (f.statuses.length && !f.statuses.includes(l.follow_status || "to_contact")) return false;
  if (f.marginMin != null && (l.marginPct == null || l.marginPct < f.marginMin)) return false;
  if (f.priceMin != null && l.price < f.priceMin) return false;
  if (f.priceMax != null && l.price > f.priceMax) return false;
  const t = f.text.trim().toLowerCase();
  if (t) {
    const hay = `${l.title || ""} ${l.commune || ""} ${l.address || ""} ${l.id}`.toLowerCase();
    if (!hay.includes(t)) return false;
  }
  return true;
}
