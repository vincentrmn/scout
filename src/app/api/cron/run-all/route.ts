import { NextRequest, NextResponse } from "next/server";
import { pool, ensureSchema, reapStaleRuns } from "@/lib/db";
import { triggerRun, triggerImmotopRun, resolveBase } from "@/lib/trigger";

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
  await reapStaleRuns(); // clôture les runs précédents restés bloqués sans réponse n8n
  const base = resolveBase(req);

  const { rows } = await pool.query<{ id: number; name: string }>(
    `SELECT id, name FROM configs WHERE watch_enabled = true ORDER BY id`
  );

  const results: Array<{ configId: number; name: string; ok: boolean; runId?: number; error?: string }> = [];
  for (const c of rows) {
    const r = await triggerRun(c.id, { base, isWatch: true });
    results.push(
      r.ok
        ? { configId: c.id, name: c.name, ok: true, runId: r.runId }
        : { configId: c.id, name: c.name, ok: false, error: r.error }
    );
  }

  // S14 — Scraper immotop (2e source), pipeline isolé. No-op si l'env n'est pas
  // configuré ; un échec ici n'affecte pas la veille atHome ci-dessus.
  let immotop: { ok: boolean; runId?: number; error?: string } | undefined;
  try {
    const im = await triggerImmotopRun(base);
    immotop = im.ok ? { ok: true, runId: im.runId } : { ok: false, error: im.error };
  } catch (e: any) {
    immotop = { ok: false, error: String(e?.message ?? e) };
  }

  return NextResponse.json({ triggered: rows.length, results, immotop });
}
