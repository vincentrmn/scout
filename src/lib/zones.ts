import { pool, ensureSchema } from "./db";
import type { Zone, ZoneTree } from "./types";

/**
 * Recupere l'arbre des zones (villes -> quartiers) depuis la base, prix inclus.
 */
export async function getZoneTree(): Promise<ZoneTree[]> {
  await ensureSchema();
  const { rows } = await pool.query<Zone>(
    `SELECT id, parent_id, label, loc_code, q_code, resale_eur_per_m2, sort_order
     FROM zones
     ORDER BY sort_order ASC, label ASC`
  );
  // pg renvoie NUMERIC en string -> on normalise en number|null.
  const norm = rows.map((r) => ({
    ...r,
    resale_eur_per_m2:
      r.resale_eur_per_m2 === null || r.resale_eur_per_m2 === undefined
        ? null
        : Number(r.resale_eur_per_m2),
  }));
  const cities = norm.filter((r) => r.parent_id === null);
  return cities.map((city) => ({
    ...city,
    quartiers: norm.filter((r) => r.parent_id === city.id),
  }));
}

/**
 * Normalise un libelle de commune atHome ("Luxembourg-Limpertsberg") vers l'id
 * de zone correspondant ("limpertsberg"). Retire le prefixe ville, les accents,
 * et slugifie. Retourne null si vide.
 */
export function quartierSlug(commune?: string | null): string | null {
  if (!commune) return null;
  let s = commune
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, ""); // retire les accents
  s = s.replace(/^luxembourg[-\s]+/, "").trim();
  s = s.replace(/['\s/]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return s || null;
}

export type ZonePriceMap = {
  /** Prix explicitement calibres par quartier (id -> €/m²). */
  ownPrices: Record<string, number>;
  /** Prix par defaut (porte par la ville), applique aux quartiers non calibres. */
  defaultPrice: number;
};

/**
 * Construit la table de resolution prix utilisee au scoring (/api/ingest).
 *   - defaultPrice = prix de la ville Luxembourg-Ville (fallback 11000 si jamais null).
 *   - ownPrices = quartiers (parent_id non NULL) ayant un prix explicite.
 */
export async function getZonePriceMap(): Promise<ZonePriceMap> {
  await ensureSchema();
  const { rows } = await pool.query<{
    id: string;
    parent_id: string | null;
    resale_eur_per_m2: string | number | null;
  }>(`SELECT id, parent_id, resale_eur_per_m2 FROM zones`);

  const num = (v: string | number | null) =>
    v === null || v === undefined ? null : Number(v);

  let defaultPrice = 11000;
  const ownPrices: Record<string, number> = {};
  for (const r of rows) {
    const price = num(r.resale_eur_per_m2);
    if (r.parent_id === null) {
      if (price !== null) defaultPrice = price; // ville -> defaut
    } else if (price !== null) {
      ownPrices[r.id] = price; // quartier calibre
    }
  }
  return { ownPrices, defaultPrice };
}

/** Resout le prix de revente au m2 pour le quartier d'un bien. */
export function resolveResalePerM2(
  commune: string | undefined,
  map: ZonePriceMap
): { resalePerM2: number; priceIsDefault: boolean } {
  const slug = quartierSlug(commune);
  if (slug && map.ownPrices[slug] != null) {
    return { resalePerM2: map.ownPrices[slug], priceIsDefault: false };
  }
  return { resalePerM2: map.defaultPrice, priceIsDefault: true };
}

/** Met a jour les prix de revente par zone. `prices` : id -> €/m² ou null (herite). */
export async function setZonePrices(prices: Record<string, number | null>): Promise<void> {
  await ensureSchema();
  const entries = Object.entries(prices);
  for (const [id, value] of entries) {
    const v = value === null || Number.isNaN(value as number) ? null : Number(value);
    await pool.query(`UPDATE zones SET resale_eur_per_m2 = $2 WHERE id = $1`, [id, v]);
  }
}
