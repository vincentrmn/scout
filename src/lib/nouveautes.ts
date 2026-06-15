import { pool, ensureSchema } from "./db";
import { DEFAULT_SCORING, type ScoringParams } from "./scoring";

// S16 — Config unique qui décide ce qui remonte en Nouveautés. Les 2 relevés
// larges (atHome + Immotop) scrapent tout ; seuls les biens qui matchent cette
// config (critères + verdict) deviennent des Nouveautés. Réglable dans l'UI.

export type NouveautesConfig = {
  surfaceMin?: number | null;
  surfaceMax?: number | null;
  priceMin?: number | null;
  priceMax?: number | null;
  cpeClasses: string[];
  includeNoCpe: boolean;
  /** État (Immotop) — ne filtre que les biens AYANT un état ; atHome passe toujours. */
  conditions: ("a_renover" | "habitable" | "renove")[];
  verdicts: ("GO" | "NEGOCIER")[];
  scoring: ScoringParams;
};

export const DEFAULT_NOUVEAUTES: NouveautesConfig = {
  surfaceMin: null,
  surfaceMax: 90,
  priceMin: null,
  priceMax: null,
  cpeClasses: [],
  includeNoCpe: false,
  conditions: [],
  verdicts: ["GO", "NEGOCIER"],
  scoring: DEFAULT_SCORING,
};

export async function getNouveautesConfig(): Promise<NouveautesConfig> {
  await ensureSchema();
  const { rows } = await pool.query<{ value: any }>(`SELECT value FROM app_settings WHERE key='nouveautes'`);
  const v = rows[0]?.value || {};
  return {
    ...DEFAULT_NOUVEAUTES,
    ...v,
    cpeClasses: Array.isArray(v.cpeClasses) ? v.cpeClasses : DEFAULT_NOUVEAUTES.cpeClasses,
    conditions: Array.isArray(v.conditions) ? v.conditions : DEFAULT_NOUVEAUTES.conditions,
    verdicts: Array.isArray(v.verdicts) && v.verdicts.length ? v.verdicts : DEFAULT_NOUVEAUTES.verdicts,
    scoring: { ...DEFAULT_SCORING, ...(v.scoring || {}) },
  };
}

export async function setNouveautesConfig(cfg: NouveautesConfig): Promise<void> {
  await ensureSchema();
  await pool.query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ('nouveautes', $1, now())
     ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now()`,
    [JSON.stringify(cfg)]
  );
}

/** Critères (hors verdict) : le bien entre-t-il dans le périmètre des Nouveautés ? */
export function matchesNouveautesCriteria(
  l: { surface?: number | null; price: number; cpe?: string | null; etat?: string | null },
  cfg: NouveautesConfig
): boolean {
  if (cfg.surfaceMin != null && (l.surface == null || l.surface < cfg.surfaceMin)) return false;
  if (cfg.surfaceMax != null && (l.surface == null || l.surface > cfg.surfaceMax)) return false;
  if (cfg.priceMin != null && l.price < cfg.priceMin) return false;
  if (cfg.priceMax != null && l.price > cfg.priceMax) return false;
  // CPE : ne filtre que les biens qui ONT une note (atHome). Un CPE inconnu
  // (Immotop, ou « en cours ») passe toujours — symétrique au filtre d'état.
  if (cfg.cpeClasses.length && cfg.cpeClasses.length < 9 && l.cpe && !cfg.cpeClasses.includes(l.cpe)) return false;
  // État : ne filtre que les biens qui ONT un état (Immotop). atHome (null) passe.
  if (cfg.conditions.length && l.etat && !cfg.conditions.includes(l.etat as any)) return false;
  return true;
}
