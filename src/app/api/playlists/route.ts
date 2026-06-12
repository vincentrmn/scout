import { NextRequest, NextResponse } from "next/server";
import { pool, ensureSchema } from "@/lib/db";
import { normalizeRules } from "@/lib/playlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/playlists — playlists + surcharges manuelles (includes/excludes).
export async function GET() {
  try {
    await ensureSchema();
    const { rows } = await pool.query(`SELECT id, name, rules FROM playlists ORDER BY id`);
    const { rows: items } = await pool.query<{ playlist_id: number; listing_id: string; kind: string }>(
      `SELECT playlist_id, listing_id, kind FROM playlist_items`
    );
    const inc = new Map<number, string[]>();
    const exc = new Map<number, string[]>();
    for (const it of items) {
      const m = it.kind === "exclude" ? exc : inc;
      if (!m.has(it.playlist_id)) m.set(it.playlist_id, []);
      m.get(it.playlist_id)!.push(it.listing_id);
    }
    const out = rows.map((p) => ({
      id: p.id,
      name: p.name,
      rules: normalizeRules(p.rules),
      includes: inc.get(p.id) ?? [],
      excludes: exc.get(p.id) ?? [],
    }));
    return NextResponse.json(out);
  } catch (err) {
    console.error("[GET /api/playlists]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

// POST /api/playlists — créer { name, rules }.
export async function POST(req: NextRequest) {
  try {
    await ensureSchema();
    const body = await req.json().catch(() => null);
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name) return NextResponse.json({ error: "nom requis" }, { status: 400 });
    const rules = normalizeRules(body?.rules);
    const { rows } = await pool.query(
      `INSERT INTO playlists (name, rules) VALUES ($1, $2) RETURNING id`,
      [name, JSON.stringify(rules)]
    );
    return NextResponse.json({ ok: true, id: rows[0].id });
  } catch (err) {
    console.error("[POST /api/playlists]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

// PUT /api/playlists?id= — mettre à jour { name?, rules? }.
export async function PUT(req: NextRequest) {
  try {
    await ensureSchema();
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });
    const body = await req.json().catch(() => null);
    const sets: string[] = [];
    const vals: any[] = [id];
    if (typeof body?.name === "string" && body.name.trim()) {
      vals.push(body.name.trim());
      sets.push(`name = $${vals.length}`);
    }
    if (body?.rules !== undefined) {
      vals.push(JSON.stringify(normalizeRules(body.rules)));
      sets.push(`rules = $${vals.length}`);
    }
    if (!sets.length) return NextResponse.json({ error: "rien à modifier" }, { status: 400 });
    sets.push(`updated_at = now()`);
    const { rowCount } = await pool.query(`UPDATE playlists SET ${sets.join(", ")} WHERE id = $1`, vals);
    if (!rowCount) return NextResponse.json({ error: "introuvable" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[PUT /api/playlists]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

// DELETE /api/playlists?id=
export async function DELETE(req: NextRequest) {
  try {
    await ensureSchema();
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });
    const { rowCount } = await pool.query(`DELETE FROM playlists WHERE id = $1`, [id]);
    if (!rowCount) return NextResponse.json({ error: "introuvable" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[DELETE /api/playlists]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
