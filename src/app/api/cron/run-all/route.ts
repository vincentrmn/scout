import { NextRequest, NextResponse } from "next/server";
import { pool, ensureSchema } from "@/lib/db";
import { triggerRun, resolveBase } from "@/lib/trigger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/cron/run-all  (header: x-cron-secret)
// Appele par n8n (Schedule) chaque matin. Relance toutes les configs en veille,
// chaque run marque is_watch=true (=> alimente les Nouveautes en Phase 3).
// Public au niveau middleware, protege ici par CRON_SECRET.
export async function POST(req: NextRequest) {
  const expected = process.env.CRON_SECRET || "";
  const got = req.headers.get("x-cron-secret") || "";
  if (!expected || got !== expected) {
    return NextResponse.json({ error: "secret invalide" }, { status: 401 });
  }

  await ensureSchema();
  const base = resolveBase(req);

  const { rows } = await pool.query<{ id: number; name: string }>(
    `SELECT id, name FROM configs WHERE watch_enabled = true ORDER BY id`
  );

  const results: Array<{ configId: number; name: string; ok: boolean; runId?: number; error?: string }> = [];
  // Sequentiel : on cree les runs un a un (le scraping lui-meme reste async cote n8n).
  for (const c of rows) {
    const r = await triggerRun(c.id, { base, isWatch: true });
    results.push(
      r.ok
        ? { configId: c.id, name: c.name, ok: true, runId: r.runId }
        : { configId: c.id, name: c.name, ok: false, error: r.error }
    );
  }

  return NextResponse.json({ triggered: rows.length, results });
}
