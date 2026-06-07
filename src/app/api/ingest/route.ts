import { NextRequest, NextResponse } from "next/server";
import { pool, ensureSchema } from "@/lib/db";
import { scoreListing, type Listing } from "@/lib/scoring";

export const runtime = "nodejs";

// n8n POST ici : { runId, secret, listings: Listing[] }
// L'app score avec les parametres de la config liee au run (source unique de verite).
export async function POST(req: NextRequest) {
  await ensureSchema();
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "json invalide" }, { status: 400 });

  const expected = process.env.INGEST_SECRET || "";
  if (expected && body.secret !== expected) {
    return NextResponse.json({ error: "secret invalide" }, { status: 401 });
  }

  const { runId, listings, error } = body as {
    runId: number;
    listings?: Listing[];
    error?: string;
  };
  if (!runId) return NextResponse.json({ error: "runId requis" }, { status: 400 });

  if (error) {
    await pool.query(`UPDATE runs SET status='error', error=$2, finished_at=now() WHERE id=$1`, [
      runId,
      String(error),
    ]);
    return NextResponse.json({ ok: true });
  }

  // Recupere les parametres de scoring de la config liee
  const runRow = await pool.query(`SELECT config_id FROM runs WHERE id=$1`, [runId]);
  if (!runRow.rows.length) return NextResponse.json({ error: "run introuvable" }, { status: 404 });
  const cfg = await pool.query(`SELECT scoring FROM configs WHERE id=$1`, [
    runRow.rows[0].config_id,
  ]);
  const scoring = cfg.rows[0]?.scoring;
  if (!scoring) return NextResponse.json({ error: "scoring introuvable" }, { status: 404 });

  const safe = Array.isArray(listings) ? listings : [];
  const scored = safe
    .filter((l) => l && typeof l.price === "number" && typeof l.surface === "number" && l.surface > 0)
    .map((l) => scoreListing(l, scoring))
    .sort((a, b) => b.marginPct - a.marginPct);

  await pool.query(
    `UPDATE runs SET status='done', count=$2, results=$3, finished_at=now() WHERE id=$1`,
    [runId, scored.length, JSON.stringify(scored)]
  );

  return NextResponse.json({ ok: true, scored: scored.length });
}
