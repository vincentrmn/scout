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

  // S2.1 — qTokens (atHome) + S14 quartierSlugs (immotop), alignés sur locCodes.
  const criteria = { ...(config.criteria || {}) };
  const locCodes: string[] = Array.isArray(criteria.locCodes) ? criteria.locCodes : [];
  let atHomeGeoOk = true;
  let quartierSlugs: string[] = [];
  if (locCodes.length) {
    const zonesRes = await pool.query<{ id: string; parent_id: string | null; loc_code: string; q_code: string | null }>(
      `SELECT id, parent_id, loc_code, q_code FROM zones WHERE loc_code = ANY($1::text[])`,
      [locCodes]
    );
    const byLoc = new Map(zonesRes.rows.map((r) => [r.loc_code, r]));
    const aligned = locCodes.map((lc) => byLoc.get(lc)).filter((z): z is NonNullable<typeof z> => !!z && !!z.q_code);
    criteria.locCodes = aligned.map((z) => z.loc_code);
    criteria.qTokens = aligned.map((z) => z.q_code as string);
    atHomeGeoOk = aligned.length > 0;
    // immotop : une zone « ville entière » (parent_id null) => pas de filtre quartier ;
    // sinon on garde les ids de quartier (= slugs immotop).
    const wholeCity = zonesRes.rows.some((z) => z.parent_id === null);
    quartierSlugs = wholeCity ? [] : zonesRes.rows.filter((z) => z.parent_id !== null).map((z) => z.id);
  }

  // S14 — sources demandées (défaut atHome) filtrées par disponibilité réelle.
  const wanted: string[] =
    Array.isArray(criteria.sources) && criteria.sources.length ? criteria.sources : ["athome"];
  const athomeWebhook = process.env.N8N_WEBHOOK_URL;
  const immotopWebhook = process.env.N8N_IMMOTOP_WEBHOOK_URL;
  const fire: ("athome" | "immotop")[] = [];
  if (wanted.includes("athome") && athomeWebhook && atHomeGeoOk) fire.push("athome");
  if (wanted.includes("immotop") && immotopWebhook) fire.push("immotop");

  if (fire.length === 0) {
    const reason =
      wanted.includes("athome") && !athomeWebhook
        ? "N8N_WEBHOOK_URL non configuré"
        : wanted.includes("athome") && !atHomeGeoOk
        ? "Aucune zone sélectionnée n'a de q_code configuré en base."
        : wanted.includes("immotop") && !immotopWebhook
        ? "immotop sélectionné mais N8N_IMMOTOP_WEBHOOK_URL non configuré."
        : "Aucune source de scraping disponible.";
    return { ok: false, status: 400, error: reason };
  }

  const run = await pool.query(
    `INSERT INTO runs (config_id, config_name, status, is_watch, scoring, sources_pending)
     VALUES ($1, $2, 'running', $3, $4, $5) RETURNING id`,
    [config.id, config.name, opts.isWatch ?? false, JSON.stringify(config.scoring ?? null), fire.length]
  );
  const runId = run.rows[0].id as number;
  const ingestSecret = process.env.INGEST_SECRET || "";

  // atHome : son échec d'envoi reste fatal pour le run (source principale).
  if (fire.includes("athome")) {
    fetch(athomeWebhook!, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId, criteria, ingestUrl: `${opts.base}/api/ingest`, ingestSecret }),
    }).catch(async (e) => {
      await pool.query(`UPDATE runs SET status='error', error=$2, finished_at=now() WHERE id=$1`, [runId, String(e)]);
    });
  }

  // immotop : best-effort. Un échec d'envoi décrémente le compteur (le run se
  // termine alors avec les seuls résultats atHome) — il ne casse jamais le run.
  if (fire.includes("immotop")) {
    // S14 — filtre d'état BBI -> ids `stato` immotop (à rénover=5, habitable=2, rénové=6).
    const STATO_BY_ETAT: Record<string, number> = { a_renover: 5, habitable: 2, renove: 6 };
    const statoIds = (Array.isArray(criteria.conditions) ? criteria.conditions : [])
      .map((c: string) => STATO_BY_ETAT[c])
      .filter((v: number | undefined): v is number => typeof v === "number");
    // S14 — bande énergie immotop (cumulative) -> id classeEnergetica.
    const ENERGY_BY_BAND: Record<string, number> = { excellente: 1, moyenne: 5, basse: 3 };
    const energyId = criteria.immotopEnergy ? ENERGY_BY_BAND[criteria.immotopEnergy] : undefined;
    const imCriteria = {
      propertyType: criteria.propertyType,
      includeNew: criteria.includeNew,
      surfaceMin: criteria.surfaceMin,
      surfaceMax: criteria.surfaceMax,
      priceMin: criteria.priceMin,
      priceMax: criteria.priceMax,
      quartierSlugs,
      statoIds,
      energyId,
      maxPages: 50,
    };
    fetch(immotopWebhook!, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId, criteria: imCriteria, source: "immotop", ingestUrl: `${opts.base}/api/ingest`, ingestSecret }),
    }).catch(async () => {
      await pool
        .query(
          `UPDATE runs SET
             sources_pending = GREATEST(COALESCE(sources_pending,1) - 1, 0),
             status = CASE WHEN GREATEST(COALESCE(sources_pending,1) - 1, 0) = 0 AND status='running' THEN 'done' ELSE status END,
             finished_at = CASE WHEN GREATEST(COALESCE(sources_pending,1) - 1, 0) = 0 AND status='running' THEN now() ELSE finished_at END
           WHERE id=$1`,
          [runId]
        )
        .catch(() => {});
    });
  }

  return { ok: true, runId };
}

/**
 * S12 — Déclenche un run de relevé de marché (is_survey) : Lux-Ville entière,
 * appartements anciens, CPE C–F, surface 25–75. Pas de config, pas de scoring.
 * Le scraper renvoie les biens à /api/ingest qui alimente market_samples.
 */
export async function triggerSurveyRun(base: string): Promise<TriggerResult> {
  await ensureSchema();

  const run = await pool.query(
    `INSERT INTO runs (config_id, config_name, status, is_survey)
     VALUES (NULL, 'Relevé de marché — atHome', 'running', true) RETURNING id`
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

  // S16 — relevé atHome : Lux-Ville, CPE C–F (cible rénovation BBI), 20–100 m².
  // On garde le filtre CPE pour limiter les requêtes « fiche détail » (1/2,5 s)
  // et tenir le scrape sous le garde-fou des 45 min. La couverture large vient
  // d'Immotop (pas de fiche détail → rapide). Alimente référentiel + comparables
  // + Marché + Nouveautés (via la config).
  const criteria: any = {
    locCodes: ["L9-luxembourg"],
    propertyType: "flat",
    cpeClasses: ["C", "D", "E", "F"],
    surfaceMin: 20,
    surfaceMax: 100,
    includeNew: false,
    maxPages: 50,
  };

  // Enrichissement du qToken (obligatoire pour que loc= soit respecté).
  const zonesRes = await pool.query<{ loc_code: string; q_code: string | null }>(
    `SELECT loc_code, q_code FROM zones WHERE loc_code = ANY($1::text[])`,
    [criteria.locCodes]
  );
  const qByLoc = new Map(zonesRes.rows.map((r) => [r.loc_code, r.q_code]));
  const aligned = criteria.locCodes
    .map((lc: string) => ({ locCode: lc, qCode: qByLoc.get(lc) ?? null }))
    .filter((p: any) => p.qCode);
  if (aligned.length === 0) {
    await pool.query(`UPDATE runs SET status='error', error=$2, finished_at=now() WHERE id=$1`, [
      runId,
      "q_code Luxembourg-Ville introuvable en base.",
    ]);
    return { ok: false, status: 400, error: "q_code Luxembourg-Ville introuvable", runId };
  }
  criteria.locCodes = aligned.map((p: any) => p.locCode);
  criteria.qTokens = aligned.map((p: any) => p.qCode);

  const payload = {
    runId,
    criteria,
    ingestUrl: `${base}/api/ingest`,
    ingestSecret: process.env.INGEST_SECRET || "",
  };

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

/**
 * S14 — Déclenche le scraper immotop (2e source), PIPELINE PARALLÈLE ET ISOLÉ.
 * Webhook + route d'ingest dédiés : n'impacte jamais le flux atHome. Si
 * `N8N_IMMOTOP_WEBHOOK_URL` n'est pas configuré, no-op silencieux (aucun run
 * créé) — atHome continue normalement.
 */
export async function triggerImmotopRun(base: string): Promise<TriggerResult> {
  const webhook = process.env.N8N_IMMOTOP_WEBHOOK_URL;
  if (!webhook) {
    return { ok: false, status: 200, error: "N8N_IMMOTOP_WEBHOOK_URL non configuré (immotop désactivé)" };
  }
  await ensureSchema();

  const run = await pool.query(
    `INSERT INTO runs (config_id, config_name, status, is_immotop)
     VALUES (NULL, 'Relevé de marché — Immotop', 'running', true) RETURNING id`
  );
  const runId = run.rows[0].id as number;

  const payload = {
    runId,
    criteria: { surfaceMin: 20, surfaceMax: 150, maxPages: 50 },
    ingestUrl: `${base}/api/ingest-immotop`,
    ingestSecret: process.env.INGEST_SECRET || "",
  };

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
