import { NextRequest, NextResponse } from "next/server";
import { pool, ensureSchema } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/findings?page=0&pageSize=30
// Opportunites decouvertes par les veilles, plus recentes d'abord, paginees.
// Jointure listings pour les infos courantes + etat de suivi.
export async function GET(req: NextRequest) {
  try {
    await ensureSchema();
    const sp = req.nextUrl.searchParams;
    const pageSize = Math.min(Math.max(parseInt(sp.get("pageSize") || "30", 10) || 30, 1), 100);
    const page = Math.max(parseInt(sp.get("page") || "0", 10) || 0, 0);
    const offset = page * pageSize;

    const totalRes = await pool.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM findings`);
    const total = totalRes.rows[0].n;

    const { rows } = await pool.query(
      `SELECT
         f.listing_id, f.run_id, f.config_name, f.verdict,
         f.margin_pct::float AS margin_pct, f.price, f.found_at,
         l.url, l.title, l.surface::float AS surface, l.commune, l.cpe, l.tracked
       FROM findings f
       JOIN listings l ON l.id = f.listing_id
       ORDER BY f.found_at DESC
       LIMIT $1 OFFSET $2`,
      [pageSize, offset]
    );

    return NextResponse.json({ items: rows, total, page, pageSize });
  } catch (err) {
    console.error("[GET /api/findings]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
