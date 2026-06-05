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

  // URL de callback que n8n appellera pour deposer les resultats
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || req.nextUrl.host;
  const proto = req.headers.get('x-forwarded-proto') || 'https';
  const base = process.env.PUBLIC_APP_URL || `${proto}://${host}`;
  const payload = {
    runId,
    criteria: config.criteria,
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
