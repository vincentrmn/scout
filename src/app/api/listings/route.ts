import { NextResponse } from "next/server";
import { pool, ensureSchema } from "@/lib/db";
import { scoreListing, DEFAULT_SCORING } from "@/lib/scoring";
import { getZonePriceMap, resolveResalePerM2 } from "@/lib/zones";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/listings?tracked=1
// Retourne les biens suivis, enrichis d'un re-scoring "a la volee" :
// DEFAULT_SCORING + prix de revente de la zone du bien (table zones).
// Pas de verdict — uniquement la marge brute calculee + le detail financier.
// force-dynamic : empeche Next.js 14 de prerendre cette route au build
// (reseau Railway prive indisponible a ce moment-la).
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

    // Re-scoring config-independant : config de reference = DEFAULT_SCORING,
    // prix de revente resolu par zone (un seul chargement pour tous les biens).
    const priceMap = await getZonePriceMap();
    const enriched = rows.map((row) => {
      if (!row.surface || row.surface <= 0) {
        return { ...row, marginPct: null };
      }
      const { resalePerM2, priceIsDefault } = resolveResalePerM2(row.commune, priceMap);
      const s = scoreListing(
        {
          id: row.id,
          url: row.url,
          title: row.title,
          price: row.price,
          surface: row.surface,
          commune: row.commune,
          cpe: row.cpe,
          rooms: row.rooms,
        },
        DEFAULT_SCORING,
        resalePerM2,
        priceIsDefault
      );
      return {
        ...row,
        resalePerM2: s.resalePerM2,
        priceIsDefault: s.priceIsDefault,
        resaleValue: s.resaleValue,
        worksCost: s.worksCost,
        acquisitionCost: s.acquisitionCost,
        resaleCost: s.resaleCost,
        totalInvested: s.totalInvested,
        netProfit: s.netProfit,
        marginPct: s.marginPct,
        maxBuyPrice: s.maxBuyPrice,
      };
    });

    return NextResponse.json(enriched);
  } catch (err) {
    console.error("[GET /api/listings]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
