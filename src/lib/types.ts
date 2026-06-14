import type { ScoringParams } from "./scoring";

export type Criteria = {
  propertyType: "apartment" | "house" | "both";
  /** S2 — codes loc atHome selectionnes via ZonePicker.
   *  Ex : ["L9-luxembourg"] (tout Lux-Ville) ou ["L10-belair","L10-merl"] (multi-quartiers).
   *  Plusieurs codes sont joints par virgule cote n8n (param atHome `loc=L10-a,L10-b`). */
  locCodes?: string[];
  /** S2.1 — tokens q atHome paralleles a locCodes (meme ordre, meme taille).
   *  Calcules automatiquement cote serveur (trigger) depuis la table `zones`. */
  qTokens?: string[];
  /** @deprecated S1 — garde pour retro-compat sur les configs existantes. */
  communes?: string[];
  /** S3 — inclure les programmes neufs en construction.
   *  false (defaut) => le builder n8n ajoute `old_build=true` et filtre isNewBuild. */
  includeNew?: boolean;
  surfaceMin?: number;
  surfaceMax?: number;
  priceMin?: number;
  priceMax?: number;
  /** Classes CPE a conserver. [] (defaut) => aucun filtre CPE ni `energy_class` URL. */
  cpeClasses: string[];
  /** S13 — quand on filtre par classes CPE, conserver AUSSI les biens sans note
   *  de CPE (« en cours d'élaboration »). true => n8n n'ajoute PAS `energy_class`
   *  à l'URL (scrape toutes les notes) et garde `CPE ∈ classes OU CPE vide`.
   *  Sans effet si cpeClasses = [] (déjà tout inclus). */
  includeNoCpe?: boolean;
  /** S14 — sources de scraping à interroger pour cette recherche.
   *  Absent / vide => ['athome'] (rétro-compat). 'immotop' n'est tenté que si
   *  N8N_IMMOTOP_WEBHOOK_URL est configuré (sinon ignoré silencieusement). */
  sources?: ("athome" | "immotop")[];
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
// Zones (S2/S4) — selection de localisation + prix de revente par zone.
// ---------------------------------------------------------------------------

export type Zone = {
  id: string;
  parent_id: string | null;
  label: string;
  loc_code: string;
  /** S2.1 — token atHome necessaire pour que loc soit respecte. */
  q_code: string | null;
  /** S4 — prix de revente cible au m2, calibre dans la page Reglages.
   *  null sur un quartier => herite du prix de sa ville (parent).
   *  Porte par la ville (parent) => prix par defaut pour ses quartiers non calibres. */
  resale_eur_per_m2: number | null;
  sort_order: number;
};

export type ZoneTree = Zone & {
  quartiers: Zone[];
};

// ---------------------------------------------------------------------------
// Stats d'un run (S3) — persistees dans runs.stats (JSONB), affichees /runs/[id].
// ---------------------------------------------------------------------------

export type RunStats = {
  totalAtHome: number;
  pagesFetched: number;
  pagesPlanned: number;
  countSold: number;
  countNew: number;
  capped: boolean;
  /** S13 — réconciliation des exclusions (renseignées par /api/ingest).
   *  countReceived = biens transmis par n8n (après ses filtres vendu/neuf/CPE).
   *  countIncomplete = biens rejetés côté app (prix ou surface manquant/invalide). */
  countReceived?: number;
  countIncomplete?: number;
};
