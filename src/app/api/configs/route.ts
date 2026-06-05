import { NextRequest, NextResponse } from "next/server";
import { pool, ensureSchema } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  await ensureSchema();
  const { rows } = await pool.query(
    `SELECT id, name, criteria, scoring, created_at, updated_at
     FROM configs ORDER BY updated_at DESC`
  );
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  await ensureSchema();
  const body = await req.json().catch(() => null);
  if (!body || !body.name || !body.criteria || !body.scoring) {
    return NextResponse.json({ error: "name, criteria, scoring requis" }, { status: 400 });
  }
  const { rows } = await pool.query(
    `INSERT INTO configs (name, criteria, scoring) VALUES ($1, $2, $3) RETURNING id`,
    [body.name, body.criteria, body.scoring]
  );
  return NextResponse.json({ id: rows[0].id });
}
