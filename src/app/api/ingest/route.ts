import { NextRequest, NextResponse } from "next/server";
import { pool, ensureSchema } from "@/lib/db";
import { scoreListing, type Listing } from "@/lib/scoring";
import { getZonePriceMap, resolveResalePerM2, quartierSlug } from "@/lib/zones";
import { classifyEtat, hasAnthropicKey } from "@/lib/classify";
import { generateProposals } from "@/lib/proposals";
import { isSameProperty } from "@/lib/dedup";
import type { RunStats } from "@/lib/types";

// S14 — fusion des résultats d'un run multi-sources. `existing` (déjà présents,
// taggés) + `incoming` (une seule source). Dédup cross-source (géo+surface+prix) :
// un bien retrouvé sur les 2 portails devient source='both' (atHome primaire),
// avec altUrl vers l'autre annonce. Ambigu (immeuble multi-lots) => gardé séparé.
function mergeRunResults(existing: any[], incoming: any[]): any[] {
  const out = existing.slice();
  for (const inc of incoming) {
    const incSrc = inc.source === "both" ? "athome" : inc.source ?? "athome";
    const hits: number[] = [];
    for (let i = 0; i < out.length; i++) {
      const e = out[i];
      const eSrc = e.source === "both" ? "athome" : e.source ?? "athome";
      if (eSrc === incSrc) continue; // même source : pas de fusion (PK gère les re-scrapes)
      if (
        isSameProperty(
          { price: e.price, surface: e.surface, lat: e.lat ?? null, lng: e.lng ?? null },
          { price: inc.price, surface: inc.surface, lat: inc.lat ?? null, lng: inc.lng ?? null }
        )
      )
        hits.push(i);
    }
    if (hits.length === 1) {
      const i = hits[0];
      const other = out[i];
      out[i] =
        incSrc === "athome"
          ? { ...inc, source: "both", altUrl: other.url }
          : { ...other, source: "both", altUrl: inc.url };
    } else {
      out.push(inc); // 0 match ou ambigu => bien séparé
    }
  }
  return out;
}

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

  // Run lie : flags (is_watch alimente les Nouveautes, is_survey le releve marche).
  const runRow = await pool.query<{ config_id: number; config_name: string; is_watch: boolean; is_survey: boolean }>(
    `SELECT config_id, config_name, is_watch, is_survey FROM runs WHERE id=$1`,
    [runId]
  );
  if (!runRow.rows.length) return NextResponse.json({ error: "run introuvable" }, { status: 404 });
  const { config_id, config_name, is_survey } = runRow.rows[0];

  const safe = Array.isArray(listings) ? listings : [];
  const filtered = safe.filter(
    (l) => l && typeof l.price === "number" && typeof l.surface === "number" && l.surface > 0
  );

  // S14 — source du POST ('athome' par défaut). Les biens immotop reçoivent un id
  // préfixé pour ne pas entrer en collision avec les ids atHome. Tout le reste du
  // pipeline (upsert, snapshots, scoring) travaille ensuite sur `items`.
  const sourceTag: "athome" | "immotop" = (body as any).source === "immotop" ? "immotop" : "athome";
  const items = filtered.map((l) => ({
    ...l,
    id: sourceTag === "immotop" ? `immotop-${l.id}` : String(l.id),
  }));

  // S13 — réconciliation des exclusions : on enregistre combien de biens n8n a
  // transmis (countReceived) et combien l'app a rejetés faute de prix/surface
  // exploitable (countIncomplete). Permet d'expliquer chaque bien manquant.
  const mergedStats: RunStats | null = stats
    ? { ...stats, countReceived: safe.length, countIncomplete: safe.length - filtered.length }
    : null;
  const mergedStatsJson = mergedStats ? JSON.stringify(mergedStats) : statsJson;

  // S5 — prix actuellement stockes (detection baisse/hausse + nouveaute). 1 SELECT batch.
  const ids = items.map((l) => l.id);
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
  // S8 — photos : on n'ecrase jamais des photos existantes par un tableau vide
  //      (un scrape qui rate les photos ne doit pas faire regresser la fiche).
  await Promise.all(
    items.map((l) => {
      const photos = Array.isArray(l.photos)
        ? l.photos.filter((p) => typeof p === "string" && p.startsWith("http")).slice(0, 6)
        : [];
      return pool.query(
        `INSERT INTO listings (id, source, price, surface, commune, rooms, title, url, cpe, photos, lat, lng, address, etat)
         VALUES ($1, $13, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $14)
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
           cpe     = EXCLUDED.cpe,
           photos  = CASE
             WHEN jsonb_array_length(EXCLUDED.photos) > 0 THEN EXCLUDED.photos
             ELSE listings.photos
           END,
           -- S10 — ne jamais écraser des coordonnées connues par un null.
           lat     = COALESCE(EXCLUDED.lat, listings.lat),
           lng     = COALESCE(EXCLUDED.lng, listings.lng),
           etat    = COALESCE(EXCLUDED.etat, listings.etat),
           address = CASE
             WHEN EXCLUDED.address IS NOT NULL AND EXCLUDED.address <> '' THEN EXCLUDED.address
             ELSE listings.address
           END`,
        [l.id, l.price, l.surface ?? null, l.commune ?? null, l.rooms ?? null, l.title ?? null, l.url, l.cpe ?? null, JSON.stringify(photos),
         typeof l.lat === "number" ? l.lat : null, typeof l.lng === "number" ? l.lng : null, l.address ?? null, sourceTag, (l as any).etat ?? null]
      );
    })
  );

  // S6 Phase 1 — Snapshot de prix : si bien nouveau OU prix change.
  await Promise.all(
    items
      .filter((l) => {
        const prev = prevPriceMap.get(l.id);
        return prev === undefined || prev !== l.price;
      })
      .map((l) =>
        pool.query(`INSERT INTO listing_snapshots (listing_id, price) VALUES ($1, $2)`, [l.id, l.price])
      )
  );

  // S12 — Run de relevé de marché : on alimente market_samples, sans scoring ni
  // Nouveautés. (Upsert listings + snapshots déjà faits ci-dessus.)
  if (is_survey) {
    const samples = await Promise.all(
      items.map(async (l) => {
        const slug = quartierSlug(l.commune);
        const priceM2 =
          typeof l.surface === "number" && l.surface > 0
            ? Math.round((l.price / l.surface) * 100) / 100
            : null;
        const description = typeof l.description === "string" ? l.description.slice(0, 2000) : null;
        const r = await pool.query(
          `INSERT INTO market_samples (listing_id, quartier_slug, price, surface, price_m2, cpe, description, url)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [l.id, slug, l.price, l.surface ?? null, priceM2, l.cpe ?? null, description, l.url ?? null]
        );
        return { id: r.rows[0].id as number, description };
      })
    );
    await pool.query(
      `UPDATE runs SET status='done', count=$2, stats=$3, finished_at=now() WHERE id=$1`,
      [runId, filtered.length, mergedStatsJson]
    );

    // S12 Phase 3 — classification LLM (séquentielle, ~5 req/s), best-effort :
    // un échec laisse etat NULL sans bloquer. Ne tourne que si la clé est posée.
    if (hasAnthropicKey()) {
      const napms = (ms: number) => new Promise((r) => setTimeout(r, ms));
      for (const s of samples) {
        if (!s.description) continue;
        try {
          const c = await classifyEtat(s.description);
          if (c) {
            await pool.query(`UPDATE market_samples SET etat=$2, etat_confidence=$3 WHERE id=$1`, [s.id, c.etat, c.confidence]);
          }
        } catch (e) {
          console.error("[classify]", s.id, e);
        }
        await napms(200);
      }
    }

    // S12 — Régénération des propositions APRÈS l'ingest (comps + état LLM frais).
    // C'est ici (et pas dans le cron qui ne fait que déclencher le scrape async)
    // que les nouveaux biens du jour deviennent une proposition. Best-effort.
    try {
      await generateProposals();
    } catch (e) {
      console.error("[ingest] generateProposals", e);
    }

    return NextResponse.json({ ok: true, survey: filtered.length });
  }

  // --- Run normal : scoring de la config ---
  const cfg = await pool.query(`SELECT scoring FROM configs WHERE id=$1`, [config_id]);
  const scoring = cfg.rows[0]?.scoring;
  if (!scoring) return NextResponse.json({ error: "scoring introuvable" }, { status: 404 });
  const priceMap = await getZonePriceMap();

  // Score + delta (taggé source pour la fusion multi-sources).
  const scored = items
    .map((l) => {
      const { resalePerM2, priceIsDefault } = resolveResalePerM2(l.commune, priceMap);
      const base = scoreListing(l, scoring, resalePerM2, priceIsDefault);
      const prev = prevPriceMap.get(l.id);
      const priceDelta = prev !== undefined && prev !== l.price ? l.price - prev : null;
      return { ...base, priceDelta, source: sourceTag };
    })
    .sort((a, b) => b.marginPct - a.marginPct);

  // S14 — finalisation multi-sources : fusion + dédup dans une transaction (verrou
  // de ligne) pour sérialiser les POST atHome/immotop concurrents sur le même run.
  //   sources_pending NULL  => run mono-source historique : finalisé direct (inchangé).
  //   sources_pending >= 1  => on décrémente ; 'done' quand le compteur atteint 0.
  // Les stats (panneau d'exclusions atHome) ne sont écrites que par le POST atHome.
  const statsForUpdate = sourceTag === "athome" ? mergedStatsJson : null;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cur = await client.query<{ results: any; sources_pending: number | null }>(
      `SELECT results, sources_pending FROM runs WHERE id=$1 FOR UPDATE`,
      [runId]
    );
    const existing = Array.isArray(cur.rows[0]?.results) ? cur.rows[0].results : [];
    const pending = cur.rows[0]?.sources_pending ?? null;
    const merged = mergeRunResults(existing, scored).sort(
      (a: any, b: any) => (b.marginPct ?? -999) - (a.marginPct ?? -999)
    );
    const newPending = pending == null ? null : Math.max(pending - 1, 0);
    const finalStatus = newPending == null || newPending <= 0 ? "done" : "running";
    await client.query(
      `UPDATE runs SET
         count = $2, results = $3, stats = COALESCE($4, stats),
         sources_pending = $5, status = $6,
         finished_at = CASE WHEN $6 = 'done' THEN now() ELSE finished_at END
       WHERE id = $1`,
      [runId, merged.length, JSON.stringify(merged), statsForUpdate, newPending, finalStatus]
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
    throw e;
  }
  client.release();

  // S6 Phase 3 — Nouveautes : EVENEMENTS GO/Negocier captures sur TOUT run
  // (manuel ou veille). Le premier run qui voit une nouveaute/baisse cree
  // l'evenement ; les suivants voient prev == prix => pas de doublon. Cale sur
  // la meme couverture que les snapshots de prix (plus de signal absorbe).
  {
    type FindingEvent = {
      listing_id: string;
      kind: "new" | "price_drop";
      verdict: string;
      margin: number;
      price: number;
      prevPrice: number | null;
    };
    const events: FindingEvent[] = [];
    for (const s of scored) {
      if (s.verdict !== "GO" && s.verdict !== "NEGOCIER") continue;
      const prev = prevPriceMap.get(s.id);
      if (prev === undefined) {
        events.push({ listing_id: s.id, kind: "new", verdict: s.verdict, margin: s.marginPct, price: s.price, prevPrice: null });
      } else if (s.price < prev) {
        events.push({ listing_id: s.id, kind: "price_drop", verdict: s.verdict, margin: s.marginPct, price: s.price, prevPrice: prev });
      }
    }
    await Promise.all(
      events.map((e) =>
        pool.query(
          `INSERT INTO findings (listing_id, run_id, config_name, kind, verdict, margin_pct, price, prev_price)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [e.listing_id, runId, config_name, e.kind, e.verdict, e.margin, e.price, e.prevPrice]
        )
      )
    );
  }

  return NextResponse.json({ ok: true, scored: scored.length });
}
