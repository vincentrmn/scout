import { NextRequest, NextResponse } from "next/server";
import { ensureSchema } from "@/lib/db";
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

    // S16 — Le scraping (relevés larges) est passé en quotidien (run-all).
    // Ce cron hebdo ne fait plus que rafraîchir la donnée Observatoire (actes
    // notariés), qui ne bouge pas souvent.
    const obs = await fetchActesVille();

    return NextResponse.json({ ok: true, observatoire: obs });
  } catch (err: any) {
    console.error("[POST /api/cron/market-survey]", err);
    return NextResponse.json({ error: err?.message ?? "Erreur serveur" }, { status: 500 });
  }
}
