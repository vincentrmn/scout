import { NextRequest, NextResponse } from "next/server";
import { pool, ensureSchema } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET  /api/listings/notes?latest=1     -> derniere activite globale (badge dashboard)
// GET  /api/listings/notes?listing_id=X -> fil d'un bien
// POST /api/listings/notes { listing_id, author, body } -> ajoute une remarque
export async function GET(req: NextRequest) {
  try {
    await ensureSchema();
    const sp = req.nextUrl.searchParams;

    if (sp.get("latest") === "1") {
      const { rows } = await pool.query(
        `SELECT author, kind, created_at FROM listing_notes ORDER BY created_at DESC LIMIT 1`
      );
      return NextResponse.json(rows[0] ?? null);
    }

    const listingId = sp.get("listing_id");
    if (!listingId) {
      return NextResponse.json({ error: "listing_id ou latest=1 requis" }, { status: 400 });
    }
    const { rows } = await pool.query(
      `SELECT id, author, kind, body, created_at
       FROM listing_notes WHERE listing_id = $1 ORDER BY created_at ASC`,
      [listingId]
    );
    return NextResponse.json(rows);
  } catch (err) {
    console.error("[GET /api/listings/notes]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  await ensureSchema();
  const body = await req.json().catch(() => null);
  if (
    !body ||
    typeof body.listing_id !== "string" ||
    typeof body.author !== "string" ||
    !body.author.trim() ||
    typeof body.body !== "string" ||
    !body.body.trim()
  ) {
    return NextResponse.json(
      { error: "listing_id, author et body (non vides) requis" },
      { status: 400 }
    );
  }
  const { rows } = await pool.query(
    `INSERT INTO listing_notes (listing_id, author, kind, body)
     VALUES ($1, $2, 'note', $3)
     RETURNING id, author, kind, body, created_at`,
    [body.listing_id, body.author.trim(), body.body.trim()]
  );
  return NextResponse.json(rows[0]);
}
