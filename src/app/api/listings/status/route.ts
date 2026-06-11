import { NextRequest, NextResponse } from "next/server";
import { pool, ensureSchema } from "@/lib/db";

export const runtime = "nodejs";

const VALID = ["to_contact", "contacted", "visit", "offer", "won", "lost"];

// POST /api/listings/status  { id: string, status: string, author: string }
// Change le statut de pipeline d'un bien suivi + journalise l'evenement
// dans listing_notes (kind='status') pour que l'autre personne voie qui a fait quoi.
export async function POST(req: NextRequest) {
  await ensureSchema();
  const body = await req.json().catch(() => null);
  if (
    !body ||
    typeof body.id !== "string" ||
    typeof body.status !== "string" ||
    !VALID.includes(body.status) ||
    typeof body.author !== "string" ||
    !body.author.trim()
  ) {
    return NextResponse.json(
      { error: "id (string), status (valide) et author (string) requis" },
      { status: 400 }
    );
  }
  const { id, status, author } = body as { id: string; status: string; author: string };
  await pool.query(`UPDATE listings SET follow_status = $2 WHERE id = $1`, [id, status]);
  await pool.query(
    `INSERT INTO listing_notes (listing_id, author, kind, body) VALUES ($1, $2, 'status', $3)`,
    [id, author.trim(), status]
  );
  return NextResponse.json({ ok: true });
}
