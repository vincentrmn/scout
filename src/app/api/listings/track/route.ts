import { NextRequest, NextResponse } from "next/server";
import { pool, ensureSchema } from "@/lib/db";
import { DEFAULT_SCORING, type ScoringParams } from "@/lib/scoring";
import { getZonePriceMap, resolveResalePerM2 } from "@/lib/zones";

export const runtime = "nodejs";

// POST /api/listings/track  { id: string, tracked: boolean, runId?: number }
// Active ou desactive le suivi d'un bien.
// tracked_at : positionne a now() a l'activation, NULL a la desactivation.
// S9 — a l'activation, on capture les hypotheses de la recherche d'origine
// (runs.scoring -> config.scoring -> defaut) + le prix de revente du quartier,
// dans listings.search_scoring, et on remet a zero un eventuel essai (analysis).
export async function POST(req: NextRequest) {
  try {
    await ensureSchema();
    const body = await req.json().catch(() => null);
    if (!body || typeof body.id !== "string" || typeof body.tracked !== "boolean") {
      return NextResponse.json({ error: "id (string) et tracked (boolean) requis" }, { status: 400 });
    }
    const { id, tracked } = body as { id: string; tracked: boolean };
    const runId = typeof body.runId === "number" ? body.runId : null;

    if (!tracked) {
      await pool.query(
        `UPDATE listings SET tracked = false, tracked_at = NULL WHERE id = $1`,
        [id]
      );
      return NextResponse.json({ ok: true });
    }

    // Resout les hypotheses de scoring a memoriser.
    let params: ScoringParams | null = null;
    if (runId !== null) {
      const r = await pool.query<{ scoring: ScoringParams | null; config_id: number | null }>(
        `SELECT scoring, config_id FROM runs WHERE id = $1`,
        [runId]
      );
      if (r.rows.length) {
        params = r.rows[0].scoring;
        if (!params && r.rows[0].config_id != null) {
          const c = await pool.query<{ scoring: ScoringParams | null }>(
            `SELECT scoring FROM configs WHERE id = $1`,
            [r.rows[0].config_id]
          );
          if (c.rows.length) params = c.rows[0].scoring;
        }
      }
    }
    if (!params) params = DEFAULT_SCORING;

    // Prix de revente du quartier du bien (capture a l'instant du suivi).
    const lr = await pool.query<{ commune: string | null }>(
      `SELECT commune FROM listings WHERE id = $1`,
      [id]
    );
    const commune = lr.rows[0]?.commune ?? undefined;
    const priceMap = await getZonePriceMap();
    const { resalePerM2 } = resolveResalePerM2(commune, priceMap);

    const snapshot = {
      worksEurPerM2: params.worksEurPerM2,
      worksVatPct: params.worksVatPct,
      notaryPct: params.notaryPct,
      resaleAgencyPct: params.resaleAgencyPct,
      targetMarginPct: params.targetMarginPct,
      resalePerM2,
    };

    await pool.query(
      `UPDATE listings
       SET tracked = true,
           tracked_at = now(),
           search_scoring = $2,
           analysis_scoring = NULL
       WHERE id = $1`,
      [id, JSON.stringify(snapshot)]
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[POST /api/listings/track]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
