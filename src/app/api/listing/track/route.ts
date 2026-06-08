import { NextRequest, NextResponse } from "next/server";
import { pool, ensureSchema } from "@/lib/db";

export const runtime = "nodejs";

// POST /api/listings/track  { id: string, tracked: boolean }
// Active ou desactive le suivi d'un bien.
// tracked_at : positionne a now() a l'activation, NULL a la desactivation.
export async function POST(req: NextRequest) {
  await ensureSchema();
  const body = await req.json().catch(() => null);
  if (
    !body ||
    typeof body.id !== "string" ||
    typeof body.tracked !== "boolean"
  ) {
    return NextResponse.json({ error: "id (string) et tracked (boolean) requis" }, { status: 400 });
  }
  const { id, tracked } = body as { id: string; tracked: boolean };
  await pool.query(
    `UPDATE listings
     SET tracked    = $2,
         tracked_at = CASE WHEN $2 THEN now() ELSE NULL END
     WHERE id = $1`,
    [id, tracked]
  );
  return NextResponse.json({ ok: true });
}
