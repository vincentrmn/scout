import { NextRequest, NextResponse } from "next/server";
import { pool, ensureSchema } from "@/lib/db";
import { scoreListing, type Listing } from "@/lib/scoring";
import { getZonePriceMap, resolveResalePerM2 } from "@/lib/zones";
import { findDuplicate, type DedupCandidate } from "@/lib/dedup";
import { getNouveautesConfig, matchesNouveautesCriteria } from "@/lib/nouveautes";
import type { RunStats } from "@/lib/types";

export const runtime = "nodejs";

// =====================================================================
// S14 — Ingest immotop (2e source). PIPELINE PARALLÈLE ET ISOLÉ.
// Route DISTINCTE de /api/ingest (atHome) : un plantage ici n'impacte
// jamais le flux atHome. La dédup ne s'exécute qu'ici (immotop regarde les
// biens atHome existants, jamais l'inverse).
//
// Pour chaque bien immotop reçu :
//   - s'il correspond (géo<150m + surface±2 + prix±3%) à UN unique bien atHome
//     existant => on RATTACHE l'annonce immotop à ce bien (alt_*) + enrichit les
//     champs manquants. Pas de nouveau listing, pas de comp (évite le double-compte).
//   - sinon => upsert d'un listing source='immotop' (id 'immotop-<id>'), snapshot,
//     scoring (DEFAULT_SCORING) + finding si nouveau GO/NÉGOCIER, market_sample.
// =====================================================================
export async function POST(req: NextRequest) {
  try {
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

    const runRow = await pool.query(`SELECT id FROM runs WHERE id=$1 AND is_immotop = true`, [runId]);
    if (!runRow.rows.length) {
      return NextResponse.json({ error: "run immotop introuvable" }, { status: 404 });
    }

    const safe = Array.isArray(listings) ? listings : [];
    const filtered = safe.filter(
      (l) => l && typeof l.price === "number" && typeof l.surface === "number" && l.surface > 0
    );

    // --- Candidats de dédup : biens atHome géolocalisés (chargés une fois). ---
    const candRows = (
      await pool.query<{ id: string; price: number | null; surface: number | null; lat: number | null; lng: number | null }>(
        `SELECT id, price, surface::float8 AS surface, lat, lng
           FROM listings
          WHERE source = 'athome' AND lat IS NOT NULL AND lng IS NOT NULL`
      )
    ).rows;
    const candidates: DedupCandidate[] = candRows.map((r) => ({
      id: r.id,
      price: r.price,
      surface: r.surface == null ? null : Number(r.surface),
      lat: r.lat,
      lng: r.lng,
    }));

    // --- Partition : biens fusionnés (rattachés à atHome) vs autonomes. ---
    const merges: Array<{ bien: Listing; matchId: string }> = [];
    const standalone: Listing[] = [];
    const usedMatch = new Set<string>();
    for (const l of filtered) {
      const res = findDuplicate(
        { price: l.price, surface: l.surface, lat: l.lat ?? null, lng: l.lng ?? null },
        candidates
      );
      if (res.kind === "unique" && !usedMatch.has(res.match.id)) {
        usedMatch.add(res.match.id);
        merges.push({ bien: l, matchId: res.match.id });
      } else {
        standalone.push(l); // none | ambiguous | match déjà pris
      }
    }

    // --- Fusions : rattache l'annonce immotop au bien atHome + enrichit. ---
    let merged = 0;
    for (const m of merges) {
      try {
        const photos = sanitizePhotos(m.bien.photos);
        await pool.query(
          `UPDATE listings SET
             alt_source = 'immotop',
             alt_id     = $2,
             alt_url    = $3,
             last_seen  = now(),
             address    = CASE WHEN (address IS NULL OR address = '') AND $4 <> '' THEN $4 ELSE address END,
             lat        = COALESCE(lat, $5),
             lng        = COALESCE(lng, $6),
             etat       = COALESCE(listings.etat, $8),
             photos     = CASE WHEN jsonb_array_length(photos) = 0 THEN $7::jsonb ELSE photos END
           WHERE id = $1`,
          [
            m.matchId,
            String(m.bien.id),
            m.bien.url ?? null,
            (m.bien.address ?? "").toString(),
            typeof m.bien.lat === "number" ? m.bien.lat : null,
            typeof m.bien.lng === "number" ? m.bien.lng : null,
            JSON.stringify(photos),
            (m.bien as any).etat ?? null,
          ]
        );
        merged++;
      } catch (e) {
        console.error("[ingest-immotop] merge", m.matchId, e);
        standalone.push(m.bien); // en cas d'échec, on le traite en autonome
      }
    }

    // --- Biens autonomes : upsert listing source='immotop'. ---
    const withId = standalone.map((l) => ({ l, lid: `immotop-${l.id}` }));
    const lids = withId.map((x) => x.lid);
    const prevRows =
      lids.length > 0
        ? (
            await pool.query<{ id: string; price: number }>(
              `SELECT id, price FROM listings WHERE id = ANY($1)`,
              [lids]
            )
          ).rows
        : [];
    const prevPriceMap = new Map(prevRows.map((r) => [r.id, r.price]));

    await Promise.all(
      withId.map(({ l, lid }) => {
        const photos = sanitizePhotos(l.photos);
        return pool.query(
          `INSERT INTO listings (id, source, price, surface, commune, rooms, title, url, cpe, photos, lat, lng, address, etat)
           VALUES ($1, 'immotop', $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13)
           ON CONFLICT (id) DO UPDATE SET
             last_seen  = now(),
             prev_price = CASE WHEN listings.price <> EXCLUDED.price THEN listings.price ELSE listings.prev_price END,
             price   = EXCLUDED.price,
             surface = EXCLUDED.surface,
             commune = EXCLUDED.commune,
             rooms   = EXCLUDED.rooms,
             title   = EXCLUDED.title,
             url     = EXCLUDED.url,
             photos  = CASE WHEN jsonb_array_length(EXCLUDED.photos) > 0 THEN EXCLUDED.photos ELSE listings.photos END,
             lat     = COALESCE(EXCLUDED.lat, listings.lat),
             lng     = COALESCE(EXCLUDED.lng, listings.lng),
             etat    = COALESCE(EXCLUDED.etat, listings.etat),
             market_status = 'active',
             gone_at = NULL,
             address = CASE WHEN EXCLUDED.address IS NOT NULL AND EXCLUDED.address <> '' THEN EXCLUDED.address ELSE listings.address END`,
          [
            lid,
            l.price,
            l.surface ?? null,
            l.commune ?? null,
            l.rooms ?? null,
            l.title ?? null,
            l.url,
            l.cpe ?? null,
            JSON.stringify(photos),
            typeof l.lat === "number" ? l.lat : null,
            typeof l.lng === "number" ? l.lng : null,
            l.address ?? null,
            (l as any).etat ?? null,
          ]
        );
      })
    );

    // Snapshots de prix (bien nouveau ou prix changé).
    await Promise.all(
      withId
        .filter(({ lid, l }) => {
          const prev = prevPriceMap.get(lid);
          return prev === undefined || prev !== l.price;
        })
        .map(({ lid, l }) =>
          pool.query(`INSERT INTO listing_snapshots (listing_id, price) VALUES ($1, $2)`, [lid, l.price])
        )
    );

    // --- Nouveautés : findings sur les biens qui matchent la config Nouveautés. ---
    const priceMap = await getZonePriceMap();
    const nvCfg = await getNouveautesConfig();
    type Ev = { lid: string; verdict: string; margin: number; price: number };
    const events: Ev[] = [];
    for (const { l, lid } of withId) {
      if (!matchesNouveautesCriteria(l, nvCfg)) continue;
      const { resalePerM2, priceIsDefault } = resolveResalePerM2(l.commune, priceMap);
      const sc = scoreListing(l, nvCfg.scoring, resalePerM2, priceIsDefault);
      if (!nvCfg.verdicts.includes(sc.verdict as any)) continue;
      const prev = prevPriceMap.get(lid);
      if (prev === undefined) events.push({ lid, verdict: sc.verdict, margin: sc.marginPct, price: l.price });
    }
    await Promise.all(
      events.map((e) =>
        pool.query(
          `INSERT INTO findings (listing_id, run_id, config_name, kind, verdict, margin_pct, price, prev_price)
           VALUES ($1, $2, 'Relevé — Immotop', 'new', $3, $4, $5, NULL)`,
          [e.lid, runId, e.verdict, e.margin, e.price]
        )
      )
    );

    // S16 — Immotop ne pilote PLUS le prix de revente (pas de CPE fiable, état
    // « rénové » conflé avec le neuf). On n'alimente donc plus market_samples ni
    // la classification LLM ni la régénération de propositions ici : c'est le
    // relevé atHome (CPE C-F) qui s'en charge. Immotop reste pour la couverture
    // (référentiel, carte, suivis) et les Nouveautés (findings ci-dessus).
    const mergedStats: RunStats | null = stats
      ? { ...stats, countReceived: safe.length, countIncomplete: safe.length - filtered.length }
      : null;
    await pool.query(
      `UPDATE runs SET status='done', count=$2, stats=$3, finished_at=now() WHERE id=$1`,
      [runId, withId.length, mergedStats ? JSON.stringify(mergedStats) : statsJson]
    );

    return NextResponse.json({ ok: true, immotop: withId.length, merged });
  } catch (err: any) {
    console.error("[POST /api/ingest-immotop]", err);
    return NextResponse.json({ error: err?.message ?? "Erreur serveur" }, { status: 500 });
  }
}

function sanitizePhotos(photos: unknown): string[] {
  return Array.isArray(photos)
    ? photos.filter((p) => typeof p === "string" && p.startsWith("http")).slice(0, 6)
    : [];
}
