import { NextRequest, NextResponse } from "next/server";
import { ensureSchema, reapStaleRuns, reapGoneListings } from "@/lib/db";
import { triggerSurveyRun, triggerImmotopRun, resolveBase } from "@/lib/trigger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/cron/run-all  (header: x-cron-secret)
// S16 — Veille quotidienne unifiée : 2 relevés LARGES (atHome + Immotop) qui
// scrapent tout Lux-Ville et alimentent Référentiel + Comparables (Prix de
// revente) + Marché + Nouveautés (via la config Nouveautés). Plus de veille
// par recherche sauvegardée (les recherches gardent leur « Relancer » manuel).
export async function POST(req: NextRequest) {
  const expected = process.env.CRON_SECRET || "";
  const got = req.headers.get("x-cron-secret") || "";
  if (!expected || got !== expected) {
    return NextResponse.json({ error: "secret invalide" }, { status: 401 });
  }

  await ensureSchema();
  await reapStaleRuns(); // clôture les runs précédents restés bloqués sans réponse n8n
  await reapGoneListings(); // S16 — marque « parti » les biens absents depuis ≥3 j (Marché)
  const base = resolveBase(req);

  // Relevé large atHome (référentiel + comps + Marché + Nouveautés).
  const atHome = await triggerSurveyRun(base);

  // Relevé large Immotop (best-effort, isolé). No-op si l'env n'est pas configuré.
  let immotop: { ok: boolean; runId?: number; error?: string } | undefined;
  try {
    const im = await triggerImmotopRun(base);
    immotop = im.ok ? { ok: true, runId: im.runId } : { ok: false, error: im.error };
  } catch (e: any) {
    immotop = { ok: false, error: String(e?.message ?? e) };
  }

  return NextResponse.json({
    atHome: atHome.ok ? { runId: atHome.runId } : { error: atHome.error },
    immotop,
  });
}
