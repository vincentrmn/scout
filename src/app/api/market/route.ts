import { NextResponse } from "next/server";
import { pool, ensureSchema } from "@/lib/db";
import { getVelocityByQuartier, getRecentSold } from "@/lib/market";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/market — vélocité de marché par quartier + flux des biens partis.
export async function GET() {
  try {
    await ensureSchema();
    const [velocity, recent, zres] = await Promise.all([
      getVelocityByQuartier(120),
      getRecentSold(60),
      pool.query<{ id: string; label: string }>(`SELECT id, label FROM zones`),
    ]);
    const labels: Record<string, string> = {};
    for (const z of zres.rows) labels[z.id] = z.label;
    return NextResponse.json({ velocity, recent, labels });
  } catch (err: any) {
    console.error("[GET /api/market]", err);
    return NextResponse.json({ error: err?.message ?? "Erreur serveur" }, { status: 500 });
  }
}
