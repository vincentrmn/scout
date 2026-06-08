import { NextRequest, NextResponse } from "next/server";
import { pool, ensureSchema } from "@/lib/db";

export const runtime = "nodejs";

// POST /api/configs/watch  { id: number, watch_enabled: boolean }
// Active/desactive la veille d'une recherche.
// (Segment statique "watch" : prioritaire sur /api/configs/[id], pas de collision.)
export async function POST(req: NextRequest) {
  await ensureSchema();
  const body = await req.json().catch(() => null);
  if (!body || typeof body.id !== "number" || typeof body.watch_enabled !== "boolean") {
    return NextResponse.json({ error: "id (number) et watch_enabled (boolean) requis" }, { status: 400 });
  }
  await pool.query(
    `UPDATE configs SET watch_enabled = $2, updated_at = now() WHERE id = $1`,
    [body.id, body.watch_enabled]
  );
  return NextResponse.json({ ok: true });
}
