import type { ScoringParams } from "./scoring";

export type Criteria = {
  propertyType: "apartment" | "house" | "both";
  communes: string[];        // ex: ["luxembourg", "limpertsberg"]
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
  communes: ["luxembourg"],
  surfaceMax: 50,
  cpeClasses: ["F", "G", "H", "I"],
  keywords: ["a renover", "travaux", "rafraichir"],
};
