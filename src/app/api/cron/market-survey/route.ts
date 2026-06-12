import { NextRequest, NextResponse } from "next/server";
import { pool, ensureSchema } from "@/lib/db";
import { triggerSurveyRun, resolveBase } from "@/lib/trigger";
import { fetchActesVille } from "@/lib/observatoire";
import { generateProposals } from "@/lib/proposals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/cron/market-survey (header x-cron-secret)
// Appelé chaque lundi par n8n. Déclenche un relevé de marché (is_survey),
// rafraîchit les données Observatoire, et régénère les propositions si de
// nouvelles données arrivent OU si > 90 jours depuis la dernière génération.
export async function POST(req: NextRequest) {
  try {
    const expected = process.env.CRON_SECRET || "";
    const got = req.headers.get("x-cron-secret") || "";
    if (!expected || got !== expected) {
      return NextResponse.json({ error: "secret invalide" }, { status: 401 });
    }
    await ensureSchema();
    const base = resolveBase(req);

    const survey = await triggerSurveyRun(base);
    const obs = await fetchActesVille();

    const last = await pool.query<{ created_at: string }>(
      `SELECT created_at FROM price_proposals ORDER BY created_at DESC LIMIT 1`
    );
    const lastGen = last.rows[0]?.created_at ? new Date(last.rows[0].created_at) : null;
    const olderThan90d = !lastGen || Date.now() - lastGen.getTime() > 90 * 24 * 3600 * 1000;

    let proposals: { created: number; total: number } | null = null;
    if (obs.updated || olderThan90d) {
      proposals = await generateProposals();
    }

    return NextResponse.json({
      ok: true,
      survey: survey.ok ? { runId: survey.runId } : { error: survey.error },
      observatoire: obs,
      regenerated: proposals,
    });
  } catch (err: any) {
    console.error("[POST /api/cron/market-survey]", err);
    return NextResponse.json({ error: err?.message ?? "Erreur serveur" }, { status: 500 });
  }
}
