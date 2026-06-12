import { pool, ensureSchema } from "./db";

export type TriggerResult =
  | { ok: true; runId: number }
  | { ok: false; status: number; error: string; runId?: number };

/**
 * Cree un run pour une config, enrichit les qTokens depuis la table zones,
 * et declenche le webhook n8n (fire-and-forget). Logique partagee entre
 * /api/trigger (lancement manuel) et /api/cron/run-all (veille auto).
 *
 * @param base  Origine publique de l'app (https://host) pour l'ingestUrl.
 * @param isWatch  true si le run provient de la veille planifiee.
 */
export async function triggerRun(
  configId: number,
  opts: { base: string; isWatch?: boolean }
): Promise<TriggerResult> {
  await ensureSchema();

  const cfg = await pool.query(`SELECT * FROM configs WHERE id = $1`, [configId]);
  if (!cfg.rows.length) return { ok: false, status: 404, error: "config introuvable" };
  const config = cfg.rows[0];

  const run = await pool.query(
    `INSERT INTO runs (config_id, config_name, status, is_watch, scoring)
     VALUES ($1, $2, 'running', $3, $4) RETURNING id`,
    [config.id, config.name, opts.isWatch ?? false, JSON.stringify(config.scoring ?? null)]
  );
  const runId = run.rows[0].id as number;

  const webhook = process.env.N8N_WEBHOOK_URL;
  if (!webhook) {
    await pool.query(`UPDATE runs SET status='error', error=$2, finished_at=now() WHERE id=$1`, [
      runId,
      "N8N_WEBHOOK_URL non configure",
    ]);
    return { ok: false, status: 500, error: "N8N_WEBHOOK_URL non configure", runId };
  }

  // S2.1 — Enrichissement des qTokens depuis la table zones (alignes sur locCodes).
  const criteria = { ...(config.criteria || {}) };
  const locCodes: string[] = Array.isArray(criteria.locCodes) ? criteria.locCodes : [];
  if (locCodes.length) {
    const zonesRes = await pool.query<{ loc_code: string; q_code: string | null }>(
      `SELECT loc_code, q_code FROM zones WHERE loc_code = ANY($1::text[])`,
      [locCodes]
    );
    const qByLoc = new Map(zonesRes.rows.map((r) => [r.loc_code, r.q_code]));
    const aligned = locCodes
      .map((lc) => ({ locCode: lc, qCode: qByLoc.get(lc) ?? null }))
      .filter((p) => p.qCode);

    criteria.locCodes = aligned.map((p) => p.locCode);
    criteria.qTokens = aligned.map((p) => p.qCode as string);

    if (aligned.length === 0) {
      await pool.query(`UPDATE runs SET status='error', error=$2, finished_at=now() WHERE id=$1`, [
        runId,
        "Aucune zone selectionnee n'a de q_code configure en base.",
      ]);
      return {
        ok: false,
        status: 400,
        error: "Aucune zone selectionnee n'a de q_code configure en base.",
        runId,
      };
    }
  }

  const payload = {
    runId,
    criteria,
    ingestUrl: `${opts.base}/api/ingest`,
    ingestSecret: process.env.INGEST_SECRET || "",
  };

  // Fire-and-forget : on ne bloque pas pendant le scraping.
  fetch(webhook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(async (e) => {
    await pool.query(`UPDATE runs SET status='error', error=$2, finished_at=now() WHERE id=$1`, [
      runId,
      String(e),
    ]);
  });

  return { ok: true, runId };
}

/** Construit l'origine publique de l'app depuis la requete (fallback PUBLIC_APP_URL). */
export function resolveBase(req: Request): string {
  if (process.env.PUBLIC_APP_URL) return process.env.PUBLIC_APP_URL;
  const h = req.headers;
  const host = h.get("x-forwarded-host") || h.get("host") || "";
  const proto = h.get("x-forwarded-proto") || "https";
  return `${proto}://${host}`;
}
