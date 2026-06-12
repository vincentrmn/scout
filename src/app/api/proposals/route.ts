import { NextRequest, NextResponse } from "next/server";
import { pool, ensureSchema } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/proposals — propositions en attente (avec le détail du calcul).
export async function GET() {
  try {
    await ensureSchema();
    const { rows } = await pool.query(
      `SELECT id, quartier_slug, proposed_eur_m2, current_eur_m2, calc, created_at
       FROM price_proposals
       WHERE status = 'pending'
       ORDER BY quartier_slug`
    );
    return NextResponse.json(rows);
  } catch (err) {
    console.error("[GET /api/proposals]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

// POST /api/proposals — { id, action: 'accept' | 'dismiss' }
// accept : écrit zones.resale_eur_per_m2 = proposé + statut accepted.
// dismiss : statut dismissed. Aucune écriture de prix sans 'accept'.
export async function POST(req: NextRequest) {
  try {
    await ensureSchema();
    const body = await req.json().catch(() => null);
    const id = Number(body?.id);
    const action = body?.action;
    if (!Number.isFinite(id) || !["accept", "dismiss"].includes(action)) {
      return NextResponse.json({ error: "id et action ('accept'|'dismiss') requis" }, { status: 400 });
    }

    if (action === "dismiss") {
      const { rowCount } = await pool.query(
        `UPDATE price_proposals SET status='dismissed', decided_at=now() WHERE id=$1 AND status='pending'`,
        [id]
      );
      if (!rowCount) return NextResponse.json({ error: "introuvable" }, { status: 404 });
      return NextResponse.json({ ok: true });
    }

    // accept
    const p = await pool.query<{ quartier_slug: string; proposed_eur_m2: number }>(
      `SELECT quartier_slug, proposed_eur_m2 FROM price_proposals WHERE id=$1 AND status='pending'`,
      [id]
    );
    if (!p.rows.length) return NextResponse.json({ error: "introuvable" }, { status: 404 });
    const { quartier_slug, proposed_eur_m2 } = p.rows[0];
    await pool.query(`UPDATE zones SET resale_eur_per_m2=$2 WHERE id=$1`, [quartier_slug, proposed_eur_m2]);
    await pool.query(`UPDATE price_proposals SET status='accepted', decided_at=now() WHERE id=$1`, [id]);
    return NextResponse.json({ ok: true, quartier_slug, applied: proposed_eur_m2 });
  } catch (err) {
    console.error("[POST /api/proposals]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
