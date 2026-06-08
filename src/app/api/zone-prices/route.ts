import { NextRequest, NextResponse } from "next/server";
import { getZoneTree, setZonePrices } from "@/lib/zones";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/zone-prices
 * Retourne l'arbre des zones avec leur prix de revente (€/m²) pour la page Reglages.
 * Reponse : { zones: ZoneTree[] }
 * Route protegee par le middleware (cookie de session requis).
 */
export async function GET() {
  try {
    const zones = await getZoneTree();
    return NextResponse.json({ zones });
  } catch (err) {
    console.error("[GET /api/zone-prices] failed", err);
    return NextResponse.json({ error: "Failed to load zone prices" }, { status: 500 });
  }
}

/**
 * POST /api/zone-prices
 * Body : { prices: { [zoneId]: number | null } }
 *   - number => prix calibre pour la zone
 *   - null   => efface le prix (quartier => herite du defaut)
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.prices !== "object" || body.prices === null) {
    return NextResponse.json({ error: "prices requis" }, { status: 400 });
  }

  // Validation + coercition : on n'accepte que number >= 0 ou null.
  const clean: Record<string, number | null> = {};
  for (const [id, raw] of Object.entries(body.prices as Record<string, unknown>)) {
    if (raw === null || raw === "" || raw === undefined) {
      clean[id] = null;
      continue;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) {
      return NextResponse.json(
        { error: `Prix invalide pour "${id}" : ${String(raw)}` },
        { status: 400 }
      );
    }
    clean[id] = Math.round(n);
  }

  try {
    await setZonePrices(clean);
    return NextResponse.json({ ok: true, updated: Object.keys(clean).length });
  } catch (err) {
    console.error("[POST /api/zone-prices] failed", err);
    return NextResponse.json({ error: "Failed to save zone prices" }, { status: 500 });
  }
}
