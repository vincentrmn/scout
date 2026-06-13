import { NextRequest, NextResponse } from "next/server";
import { ensureSchema } from "@/lib/db";
import { triggerSurveyRun, resolveBase } from "@/lib/trigger";
import { fetchActesVille } from "@/lib/observatoire";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/cron/market-survey (header x-cron-secret)
// Appelé chaque lundi par n8n. Déclenche le relevé de marché (is_survey) et
// rafraîchit la décote Observatoire. La régénération des propositions a lieu
// À LA FIN de l'ingest du relevé (cf. /api/ingest), une fois les comps + l'état
// LLM frais en base — pas ici, car le scrape est asynchrone (fire-and-forget).
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

    return NextResponse.json({
      ok: true,
      survey: survey.ok ? { runId: survey.runId } : { error: survey.error },
      observatoire: obs,
      note: "Propositions régénérées à la fin de l'ingest du relevé.",
    });
  } catch (err: any) {
    console.error("[POST /api/cron/market-survey]", err);
    return NextResponse.json({ error: err?.message ?? "Erreur serveur" }, { status: 500 });
  }
}
