import { NextResponse } from "next/server";
import { pool, ensureSchema } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/listings?tracked=1
// Retourne les biens suivis. force-dynamic : empeche Next.js 14 de prerendre
// cette route au build (reseau Railway prive indisponible a ce moment-la).
export async function GET() {
  try {
    await ensureSchema();
    const { rows } = await pool.query(`
      SELECT
        id,
        price,
        prev_price,
        surface::float  AS surface,
        commune,
        rooms,
        title,
        url,
        cpe,
        first_seen,
        last_seen,
        tracked,
        tracked_at,
        CASE
          WHEN prev_price IS NOT NULL AND prev_price <> price
          THEN price - prev_price
          ELSE NULL
        END AS price_delta
      FROM listings
      WHERE tracked = true
      ORDER BY tracked_at DESC NULLS LAST
    `);
    return NextResponse.json(rows);
  } catch (err) {
    console.error("[GET /api/listings]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
