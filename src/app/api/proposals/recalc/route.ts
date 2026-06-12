import { NextResponse } from "next/server";
import { ensureSchema } from "@/lib/db";
import { generateProposals } from "@/lib/proposals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/proposals/recalc — régénère les propositions à la demande
// (bouton « Recalculer maintenant »). Utilise les market_samples déjà collectés.
export async function POST() {
  try {
    await ensureSchema();
    const result = await generateProposals();
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    console.error("[POST /api/proposals/recalc]", err);
    return NextResponse.json({ error: err?.message ?? "Erreur serveur" }, { status: 500 });
  }
}
