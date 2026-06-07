import type { ScoringParams } from "./scoring";

export type Criteria = {
  propertyType: "apartment" | "house" | "both";
  /** S2 — codes loc atHome sélectionnés via ZonePicker.
   *  Ex : ["L9-luxembourg"] (tout Lux-Ville) ou ["L10-belair","L10-merl"] (multi-quartiers).
   *  Plusieurs codes sont joints par virgule côté n8n (param atHome `loc=L10-a,L10-b`). */
  locCodes?: string[];
  /** @deprecated S1 — gardé pour rétro-compat sur les configs existantes.
   *  Le builder n8n lit `communes[0]` comme code loc si `locCodes` est absent. */
  communes?: string[];
  surfaceMin?: number;
  surfaceMax?: number;
  priceMin?: number;
  priceMax?: number;
  cpeClasses: string[];      // classes a conserver, ex: ["F","G","H","I"]
  keywords: string[];        // mots-cles "travaux", ex: ["a renover","travaux"]
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
  surfaceMax: 50,
  cpeClasses: ["F", "G", "H", "I"],
  keywords: ["a renover", "travaux", "rafraichir"],
};

// ---------------------------------------------------------------------------
// Zones (S2) — sélection de localisation hiérarchique (villes → quartiers).
// ---------------------------------------------------------------------------

export type Zone = {
  id: string;
  parent_id: string | null;
  label: string;
  loc_code: string;
  sort_order: number;
};

export type ZoneTree = Zone & {
  quartiers: Zone[];
};
