import { NextRequest, NextResponse } from "next/server";
import { pool, ensureSchema } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  await ensureSchema();
  const id = req.nextUrl.searchParams.get("id");
  if (id) {
    const { rows } = await pool.query(`SELECT * FROM runs WHERE id = $1`, [id]);
    if (!rows.length) return NextResponse.json({ error: "introuvable" }, { status: 404 });
    return NextResponse.json(rows[0]);
  }
  const { rows } = await pool.query(
    `SELECT id, config_id, config_name, status, count, error, started_at, finished_at
     FROM runs ORDER BY started_at DESC LIMIT 50`
  );
  return NextResponse.json(rows);
}
