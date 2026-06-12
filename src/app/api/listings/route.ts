import { NextResponse } from "next/server";
import { pool, ensureSchema } from "@/lib/db";
import { scoreListing, DEFAULT_SCORING } from "@/lib/scoring";
import { getZonePriceMap, resolveResalePerM2 } from "@/lib/zones";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/listings?tracked=1
// Biens suivis, enrichis : re-scoring a la volee (DEFAULT_SCORING + prix zone,
// sans verdict), historique de prix (S6) et suivi collaboratif (S7 :
// follow_status + fil de notes/journal).
export async function GET() {
  try {
    await ensureSchema();
    const { rows } = await pool.query(`
      SELECT
        id, price, prev_price,
        surface::float AS surface,
        commune, rooms, title, url, cpe,
        first_seen, last_seen, tracked, tracked_at,
        follow_status, photos, search_scoring, analysis_scoring,
        CASE
          WHEN prev_price IS NOT NULL AND prev_price <> price
          THEN price - prev_price
          ELSE NULL
        END AS price_delta
      FROM listings
      WHERE tracked = true
      ORDER BY tracked_at DESC NULLS LAST
    `);

    const ids = rows.map((r) => r.id);

    // S6 Phase 1 — historique de prix (un seul SELECT batch).
    const histMap = new Map<string, { price: number; seen_at: string }[]>();
    // S7 — fil de notes + journal (un seul SELECT batch).
    const notesMap = new Map<string, { id: number; author: string; kind: string; body: string; created_at: string }[]>();

    if (ids.length > 0) {
      const { rows: snaps } = await pool.query<{
        listing_id: string;
        price: number;
        seen_at: string;
      }>(
        `SELECT listing_id, price, seen_at
         FROM listing_snapshots
         WHERE listing_id = ANY($1)
         ORDER BY seen_at ASC`,
        [ids]
      );
      for (const s of snaps) {
        if (!histMap.has(s.listing_id)) histMap.set(s.listing_id, []);
        histMap.get(s.listing_id)!.push({ price: s.price, seen_at: s.seen_at });
      }

      const { rows: notes } = await pool.query<{
        id: number;
        listing_id: string;
        author: string;
        kind: string;
        body: string;
        created_at: string;
      }>(
        `SELECT id, listing_id, author, kind, body, created_at
         FROM listing_notes
         WHERE listing_id = ANY($1)
         ORDER BY created_at ASC`,
        [ids]
      );
      for (const n of notes) {
        if (!notesMap.has(n.listing_id)) notesMap.set(n.listing_id, []);
        notesMap.get(n.listing_id)!.push({ id: n.id, author: n.author, kind: n.kind, body: n.body, created_at: n.created_at });
      }
    }

    // S9 — Re-scoring base sur les hypotheses de la recherche d'origine
    // (search_scoring), surchargees par un eventuel essai (analysis_scoring).
    // Defaut historique si aucune capture (biens suivis avant la S9).
    const priceMap = await getZonePriceMap();
    const enriched = rows.map((row) => {
      const history = histMap.get(row.id) ?? [];
      const notes = notesMap.get(row.id) ?? [];

      // Prix de revente du quartier (sert de defaut et a qualifier la source).
      const zone = resolveResalePerM2(row.commune, priceMap);
      // Hypotheses de la recherche : capturees, sinon defaut + prix de zone.
      const baseline = row.search_scoring
        ? { ...row.search_scoring }
        : { ...DEFAULT_SCORING, resalePerM2: zone.resalePerM2 };
      const analysis = row.analysis_scoring ?? null;
      const eff = analysis ?? baseline;

      if (!row.surface || row.surface <= 0) {
        return { ...row, marginPct: null, baselineScoring: baseline, analysisScoring: analysis, history, notes };
      }

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
        {
          worksEurPerM2: eff.worksEurPerM2,
          worksVatPct: eff.worksVatPct,
          notaryPct: eff.notaryPct,
          resaleAgencyPct: eff.resaleAgencyPct,
          targetMarginPct: eff.targetMarginPct,
        },
        eff.resalePerM2,
        zone.priceIsDefault
      );
      return {
        ...row,
        resalePerM2: s.resalePerM2,
        priceIsDefault: zone.priceIsDefault,
        resaleValue: s.resaleValue,
        worksCost: s.worksCost,
        acquisitionCost: s.acquisitionCost,
        resaleCost: s.resaleCost,
        totalInvested: s.totalInvested,
        netProfit: s.netProfit,
        marginPct: s.marginPct,
        maxBuyPrice: s.maxBuyPrice,
        worksVatPct: s.worksVatPct,
        notaryPct: s.notaryPct,
        resaleAgencyPct: s.resaleAgencyPct,
        // Jeux d'hypotheses pour le panneau d'analyse (essai de rentabilite).
        baselineScoring: baseline,
        analysisScoring: analysis,
        history,
        notes,
      };
    });

    return NextResponse.json(enriched);
  } catch (err) {
    console.error("[GET /api/listings]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
