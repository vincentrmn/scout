import { NextRequest, NextResponse } from "next/server";
import { pool, ensureSchema } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  await ensureSchema();
  const { configId } = await req.json().catch(() => ({}));
  if (!configId) return NextResponse.json({ error: "configId requis" }, { status: 400 });

  const cfg = await pool.query(`SELECT * FROM configs WHERE id = $1`, [configId]);
  if (!cfg.rows.length) return NextResponse.json({ error: "config introuvable" }, { status: 404 });
  const config = cfg.rows[0];

  // Cree le run en statut "running"
  const run = await pool.query(
    `INSERT INTO runs (config_id, config_name, status) VALUES ($1, $2, 'running') RETURNING id`,
    [config.id, config.name]
  );
  const runId = run.rows[0].id;

  const webhook = process.env.N8N_WEBHOOK_URL;
  if (!webhook) {
    await pool.query(`UPDATE runs SET status='error', error=$2, finished_at=now() WHERE id=$1`, [
      runId,
      "N8N_WEBHOOK_URL non configure",
    ]);
    return NextResponse.json({ error: "N8N_WEBHOOK_URL non configure", runId }, { status: 500 });
  }

  // S2.1 — Enrichissement automatique des qTokens a partir de la table zones.
  // Le form n'envoie que locCodes ; les q sont sensibles (atHome) et resident
  // cote serveur. On les look-up et on les aligne en parallele de locCodes.
  // Toute zone sans q_code en base est filtree (sinon l'index serait casse).
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
      .filter((p) => p.qCode); // exclure les zones sans q_code (eviterait un alignement casse)

    criteria.locCodes = aligned.map((p) => p.locCode);
    criteria.qTokens = aligned.map((p) => p.qCode as string);

    if (aligned.length === 0) {
      await pool.query(`UPDATE runs SET status='error', error=$2, finished_at=now() WHERE id=$1`, [
        runId,
        "Aucune zone selectionnee n'a de q_code configure en base.",
      ]);
      return NextResponse.json(
        { error: "Aucune zone selectionnee n'a de q_code configure en base.", runId },
        { status: 400 }
      );
    }
  }

  // URL de callback que n8n appellera pour deposer les resultats
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || req.nextUrl.host;
  const proto = req.headers.get('x-forwarded-proto') || 'https';
  const base = process.env.PUBLIC_APP_URL || `${proto}://${host}`;
  const payload = {
    runId,
    criteria,
    ingestUrl: `${base}/api/ingest`,
    ingestSecret: process.env.INGEST_SECRET || "",
  };

  // Fire-and-forget : on ne bloque pas l'interface pendant le scraping
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

  return NextResponse.json({ runId });
}
