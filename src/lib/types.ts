import type { ScoringParams } from "./scoring";

export type Criteria = {
  propertyType: "apartment" | "house" | "both";
  /** S2 — codes loc atHome selectionnes via ZonePicker.
   *  Ex : ["L9-luxembourg"] (tout Lux-Ville) ou ["L10-belair","L10-merl"] (multi-quartiers).
   *  Plusieurs codes sont joints par virgule cote n8n (param atHome `loc=L10-a,L10-b`). */
  locCodes?: string[];
  /** S2.1 — tokens q atHome paralleles a locCodes (meme ordre, meme taille).
   *  Calcules automatiquement cote serveur (trigger) depuis la table `zones`.
   *  Le form n'a pas besoin de les envoyer ; on les enrichit a la volee. */
  qTokens?: string[];
  /** @deprecated S1 — garde pour retro-compat sur les configs existantes.
   *  Le builder n8n lit `communes[0]` comme code loc si `locCodes` est absent. */
  communes?: string[];
  /** S3 — inclure les programmes neufs en construction.
   *  false (defaut) => le builder n8n ajoute `old_build=true` et filtre isNewBuild.
   *  true => aucun filtre neuf, ni cote atHome ni cote scrape. */
  includeNew?: boolean;
  surfaceMin?: number;
  surfaceMax?: number;
  priceMin?: number;
  priceMax?: number;
  /** Classes CPE a conserver, ex: ["F","G","H","I"].
   *  [] (defaut S3, toggle "Toutes les notes CPE" ON) => aucun filtre CPE,
   *  et pas de parametre `energy_class` ajoute a l'URL atHome (gain de temps). */
  cpeClasses: string[];
};

export type ConfigRow = {
  id: number;
  name: string;
  criteria: Criteria;
  scoring: ScoringParams;
  created_at: string;
  updated_at: string;
};

export const DEFAULT_CRITERIA: Criteria = {
  propertyType: "apartment",
  locCodes: ["L9-luxembourg"],
  includeNew: false,
  surfaceMax: 50,
  cpeClasses: [],
};

// ---------------------------------------------------------------------------
// Zones (S2) — selection de localisation hierarchique (villes -> quartiers).
// ---------------------------------------------------------------------------

export type Zone = {
  id: string;
  parent_id: string | null;
  label: string;
  loc_code: string;
  /** S2.1 — token atHome necessaire pour que loc soit respecte. */
  q_code: string | null;
  sort_order: number;
};

export type ZoneTree = Zone & {
  quartiers: Zone[];
};

// ---------------------------------------------------------------------------
// Stats d'un run (S3) — remontees par n8n dans le POST /api/ingest,
// persistees dans la colonne runs.stats (JSONB) et affichees sur /runs/[id].
// ---------------------------------------------------------------------------

export type RunStats = {
  totalAtHome: number;   // search.total cote atHome (apres filtres URL)
  pagesFetched: number;  // pages SRP reellement scrapees
  pagesPlanned: number;  // pages prevues (min(ceil(total/20), maxPages))
  countSold: number;     // biens exclus car deja vendus
  countNew: number;      // biens exclus car neufs (si includeNew=false)
  capped: boolean;       // true si le besoin depassait maxPages
};
