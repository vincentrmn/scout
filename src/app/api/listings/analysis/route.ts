import { NextRequest, NextResponse } from "next/server";
import { pool, ensureSchema } from "@/lib/db";

export const runtime = "nodejs";

// POST /api/listings/analysis  { id: string, scoring: Snapshot | null }
// S9 — Essai de rentabilite persiste sur un bien suivi (partage Vincent/Jamie).
//   scoring = objet  -> enregistre l'essai (analysis_scoring)
//   scoring = null   -> reinitialise (revient aux hypotheses de la recherche)
const FIELDS = [
  "worksEurPerM2",
  "worksVatPct",
  "notaryPct",
  "resaleAgencyPct",
  "targetMarginPct",
  "resalePerM2",
] as const;

export async function POST(req: NextRequest) {
  try {
    await ensureSchema();
    const body = await req.json().catch(() => null);
    if (!body || typeof body.id !== "string") {
      return NextResponse.json({ error: "id (string) requis" }, { status: 400 });
    }
    const { id } = body as { id: string };

    // Reinitialisation.
    if (!body.scoring) {
      await pool.query(`UPDATE listings SET analysis_scoring = NULL WHERE id = $1`, [id]);
      return NextResponse.json({ ok: true });
    }

    // Validation : tous les champs numeriques et finis.
    const snapshot: Record<string, number> = {};
    for (const f of FIELDS) {
      const v = Number(body.scoring[f]);
      if (!Number.isFinite(v)) {
        return NextResponse.json({ error: `Champ invalide : ${f}` }, { status: 400 });
      }
      snapshot[f] = v;
    }

    await pool.query(`UPDATE listings SET analysis_scoring = $2 WHERE id = $1`, [
      id,
      JSON.stringify(snapshot),
    ]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[POST /api/listings/analysis]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
