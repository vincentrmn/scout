import { NextRequest, NextResponse } from "next/server";
import { getNouveautesConfig, setNouveautesConfig, DEFAULT_NOUVEAUTES, type NouveautesConfig } from "@/lib/nouveautes";
import { DEFAULT_SCORING } from "@/lib/scoring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getNouveautesConfig());
  } catch (err: any) {
    console.error("[GET /api/nouveautes-config]", err);
    return NextResponse.json({ error: err?.message ?? "Erreur serveur" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const b = await req.json().catch(() => ({}));
    const num = (v: any) => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
    const cfg: NouveautesConfig = {
      surfaceMin: num(b.surfaceMin),
      surfaceMax: num(b.surfaceMax),
      priceMin: num(b.priceMin),
      priceMax: num(b.priceMax),
      cpeClasses: Array.isArray(b.cpeClasses) ? b.cpeClasses.filter((c: any) => typeof c === "string") : [],
      includeNoCpe: !!b.includeNoCpe,
      conditions: Array.isArray(b.conditions) ? b.conditions.filter((c: any) => ["a_renover", "habitable", "renove"].includes(c)) : [],
      verdicts: Array.isArray(b.verdicts) && b.verdicts.length
        ? b.verdicts.filter((v: any) => ["GO", "NEGOCIER"].includes(v))
        : DEFAULT_NOUVEAUTES.verdicts,
      scoring: {
        worksEurPerM2: num(b.scoring?.worksEurPerM2) ?? DEFAULT_SCORING.worksEurPerM2,
        worksVatPct: num(b.scoring?.worksVatPct) ?? DEFAULT_SCORING.worksVatPct,
        notaryPct: num(b.scoring?.notaryPct) ?? DEFAULT_SCORING.notaryPct,
        resaleAgencyPct: num(b.scoring?.resaleAgencyPct) ?? DEFAULT_SCORING.resaleAgencyPct,
        targetMarginPct: num(b.scoring?.targetMarginPct) ?? DEFAULT_SCORING.targetMarginPct,
      },
    };
    if (!cfg.verdicts.length) cfg.verdicts = ["GO", "NEGOCIER"];
    await setNouveautesConfig(cfg);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[POST /api/nouveautes-config]", err);
    return NextResponse.json({ error: err?.message ?? "Erreur serveur" }, { status: 500 });
  }
}
