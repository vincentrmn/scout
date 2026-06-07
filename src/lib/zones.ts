import { pool, ensureSchema } from "./db";
import type { Zone, ZoneTree } from "./types";

/**
 * Recupere l'arbre des zones (villes -> quartiers) depuis la base.
 *
 * Convention :
 *   - Une "ville" est une zone avec parent_id = NULL et un loc_code (le code "tout ville" atHome).
 *   - Un "quartier" est une zone avec parent_id = id de la ville et un loc_code (code atHome du quartier).
 *   - Chaque zone porte aussi son q_code, token atHome necessaire pour que loc= soit respecte.
 *
 * Pour ajouter un quartier sans redeployer :
 *   INSERT INTO zones (id, parent_id, label, loc_code, q_code, sort_order)
 *   VALUES ('new-id', 'lux-ville', 'Nouveau Quartier', 'L10-nouveau', 'xxxxxxxx', 99);
 */
export async function getZoneTree(): Promise<ZoneTree[]> {
  await ensureSchema();
  const { rows } = await pool.query<Zone>(
    `SELECT id, parent_id, label, loc_code, q_code, sort_order
     FROM zones
     ORDER BY sort_order ASC, label ASC`
  );
  const cities = rows.filter((r) => r.parent_id === null);
  return cities.map((city) => ({
    ...city,
    quartiers: rows.filter((r) => r.parent_id === city.id),
  }));
}
