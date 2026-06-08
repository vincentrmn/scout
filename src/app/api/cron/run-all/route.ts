import { NextRequest, NextResponse } from "next/server";
import { pool, ensureSchema } from "@/lib/db";
import { triggerRun, resolveBase } from "@/lib/trigger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/cron/run-all  (header: x-cron-secret)
// VERSION DIAGNOSTIC TEMPORAIRE : en cas de mismatch, renvoie des infos sures
// (longueurs + booleens, jamais la valeur) pour localiser la cause.
export async function POST(req: NextRequest) {
  const expected = process.env.CRON_SECRET || "";
  const got = req.headers.get("x-cron-secret") || "";
  if (!expected || got !== expected) {
    return NextResponse.json(
      {
        error: "secret invalide",
        debug: {
          envSet: !!process.env.CRON_SECRET, // false => CRON_SECRET absent du process (pas redeploye / pas pose)
          envLen: expected.length,           // 48 attendu
          gotLen: got.length,                // 48 attendu (0 => header non recu)
          match: got === expected,           // doit etre true
        },
      },
      { status: 401 }
    );
  }

  await ensureSchema();
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

  return NextResponse.json({ triggered: rows.length, results });
}
