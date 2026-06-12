import { NextRequest, NextResponse } from "next/server";
import { pool, ensureSchema } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/playlists/items — surcharge manuelle d'appartenance.
//   { playlistId, listingId, kind: 'include' | 'exclude' | 'none' }
//   'none' supprime la surcharge (retour aux règles auto).
export async function POST(req: NextRequest) {
  try {
    await ensureSchema();
    const body = await req.json().catch(() => null);
    const playlistId = Number(body?.playlistId);
    const listingId = typeof body?.listingId === "string" ? body.listingId : "";
    const kind = body?.kind;
    if (!Number.isFinite(playlistId) || !listingId || !["include", "exclude", "none"].includes(kind)) {
      return NextResponse.json({ error: "playlistId, listingId, kind requis" }, { status: 400 });
    }
    if (kind === "none") {
      await pool.query(`DELETE FROM playlist_items WHERE playlist_id = $1 AND listing_id = $2`, [playlistId, listingId]);
    } else {
      await pool.query(
        `INSERT INTO playlist_items (playlist_id, listing_id, kind) VALUES ($1, $2, $3)
         ON CONFLICT (playlist_id, listing_id) DO UPDATE SET kind = EXCLUDED.kind`,
        [playlistId, listingId, kind]
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[POST /api/playlists/items]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
