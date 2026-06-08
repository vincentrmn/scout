import { NextRequest, NextResponse } from "next/server";
import { pool, ensureSchema } from "@/lib/db";
import { scoreListing, type Listing } from "@/lib/scoring";
import { getZonePriceMap, resolveResalePerM2 } from "@/lib/zones";
import type { RunStats } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  await ensureSchema();
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "json invalide" }, { status: 400 });

  const expected = process.env.INGEST_SECRET || "";
  if (expected && body.secret !== expected) {
    return NextResponse.json({ error: "secret invalide" }, { status: 401 });
  }

  const { runId, listings, stats, error } = body as {
    runId: number;
    listings?: Listing[];
    stats?: RunStats;
    error?: string;
  };
  if (!runId) return NextResponse.json({ error: "runId requis" }, { status: 400 });

  const statsJson = stats ? JSON.stringify(stats) : null;

  if (error) {
    await pool.query(
      `UPDATE runs SET status='error', error=$2, stats=$3, finished_at=now() WHERE id=$1`,
      [runId, String(error), statsJson]
    );
    return NextResponse.json({ ok: true });
  }

  // Run lie : scoring de la config + flags (is_watch alimente les Nouveautes).
  const runRow = await pool.query<{ config_id: number; config_name: string; is_watch: boolean }>(
    `SELECT config_id, config_name, is_watch FROM runs WHERE id=$1`,
    [runId]
  );
  if (!runRow.rows.length) return NextResponse.json({ error: "run introuvable" }, { status: 404 });
  const { config_id, config_name, is_watch } = runRow.rows[0];

  const cfg = await pool.query(`SELECT scoring FROM configs WHERE id=$1`, [config_id]);
  const scoring = cfg.rows[0]?.scoring;
  if (!scoring) return NextResponse.json({ error: "scoring introuvable" }, { status: 404 });

  const priceMap = await getZonePriceMap();

  const safe = Array.isArray(listings) ? listings : [];
  const filtered = safe.filter(
    (l) => l && typeof l.price === "number" && typeof l.surface === "number" && l.surface > 0
  );

  // S5 — prix actuellement stockes (detection baisse/hausse + nouveaute). 1 SELECT batch.
  const ids = filtered.map((l) => l.id);
  const prevRows =
    ids.length > 0
      ? (
          await pool.query<{ id: string; price: number }>(
            `SELECT id, price FROM listings WHERE id = ANY($1)`,
            [ids]
          )
        ).rows
      : [];
  const prevPriceMap = new Map(prevRows.map((r) => [r.id, r.price]));

  // S5 — Upsert (ne touche jamais tracked / tracked_at / first_seen).
  await Promise.all(
    filtered.map((l) =>
      pool.query(
        `INSERT INTO listings (id, price, surface, commune, rooms, title, url, cpe)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO UPDATE SET
           last_seen  = now(),
           prev_price = CASE
             WHEN listings.price <> EXCLUDED.price THEN listings.price
             ELSE listings.prev_price
           END,
           price   = EXCLUDED.price,
           surface = EXCLUDED.surface,
           commune = EXCLUDED.commune,
           rooms   = EXCLUDED.rooms,
           title   = EXCLUDED.title,
           url     = EXCLUDED.url,
           cpe     = EXCLUDED.cpe`,
        [l.id, l.price, l.surface ?? null, l.commune ?? null, l.rooms ?? null, l.title ?? null, l.url, l.cpe ?? null]
      )
    )
  );

  // S6 Phase 1 — Snapshot de prix : si bien nouveau OU prix change.
  await Promise.all(
    filtered
      .filter((l) => {
        const prev = prevPriceMap.get(l.id);
        return prev === undefined || prev !== l.price;
      })
      .map((l) =>
        pool.query(`INSERT INTO listing_snapshots (listing_id, price) VALUES ($1, $2)`, [l.id, l.price])
      )
  );

  // Score + delta
  const scored = filtered
    .map((l) => {
      const { resalePerM2, priceIsDefault } = resolveResalePerM2(l.commune, priceMap);
      const base = scoreListing(l, scoring, resalePerM2, priceIsDefault);
      const prev = prevPriceMap.get(l.id);
      const priceDelta = prev !== undefined && prev !== l.price ? l.price - prev : null;
      return { ...base, priceDelta };
    })
    .sort((a, b) => b.marginPct - a.marginPct);

  await pool.query(
    `UPDATE runs SET status='done', count=$2, results=$3, stats=$4, finished_at=now() WHERE id=$1`,
    [runId, scored.length, JSON.stringify(scored), statsJson]
  );

  // S6 Phase 3 — Nouveautes : sur un run de veille, capture TOUS les biens classes
  // GO/NEGOCIER. PK listing_id + ON CONFLICT DO NOTHING => 1 entree par bien (un bien
  // deja flague ne reapparait pas). Le 1er passage remplit a partir des opportunites existantes.
  if (is_watch) {
    const opportunities = scored.filter((s) => s.verdict === "GO" || s.verdict === "NEGOCIER");
    await Promise.all(
      opportunities.map((s) =>
        pool.query(
          `INSERT INTO findings (listing_id, run_id, config_name, verdict, margin_pct, price)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (listing_id) DO NOTHING`,
          [s.id, runId, config_name, s.verdict, s.marginPct, s.price]
        )
      )
    );
  }

  return NextResponse.json({ ok: true, scored: scored.length });
}
