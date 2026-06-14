import { pool, ensureSchema } from "./db";
import { quartierSlug } from "./zones";

// S15 — Vélocité de marché. On exploite les biens passés en market_status='sold'
// (signal isSoldProperty d'atHome capté à l'ingest). On en tire, par quartier :
//   - durée de vente médiane (sold_at − first_seen)
//   - décote médiane affiché→vente (1er prix vu → prix à la vente)
// Caveat : first_seen = 1re fois où NOUS avons vu le bien (borne basse de l'âge réel).

type SoldRow = {
  id: string;
  commune: string | null;
  sold_at: string;
  first_seen: string;
  sold_price: number | null;
  first_price: number | null;
  title: string | null;
  url: string | null;
  surface: number | null;
  tracked: boolean;
  source: string | null;
};

async function fetchSold(days: number): Promise<SoldRow[]> {
  const { rows } = await pool.query<SoldRow>(
    `SELECT l.id, l.commune, l.sold_at, l.first_seen, l.sold_price,
            l.title, l.url, l.surface::float8 AS surface, l.tracked, l.source,
            (SELECT s.price FROM listing_snapshots s WHERE s.listing_id = l.id ORDER BY s.seen_at ASC LIMIT 1) AS first_price
       FROM listings l
      WHERE l.market_status = 'sold' AND l.sold_at IS NOT NULL
        AND l.sold_at > now() - make_interval(days => $1::int)
      ORDER BY l.sold_at DESC`,
    [days]
  );
  return rows;
}

const domDays = (r: SoldRow) =>
  (new Date(r.sold_at).getTime() - new Date(r.first_seen).getTime()) / 86_400_000;

function decotePct(r: SoldRow): number | null {
  if (r.first_price && r.sold_price && r.first_price > 0) {
    return Math.round(((r.first_price - r.sold_price) / r.first_price) * 1000) / 10;
  }
  return null;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export type QuartierVelocity = {
  slug: string;
  count: number;
  medianDays: number | null;
  medianDecote: number | null;
};

/** Stats de vélocité par quartier (biens vendus, fenêtre `days`). */
export async function getVelocityByQuartier(days = 120): Promise<QuartierVelocity[]> {
  await ensureSchema();
  const rows = await fetchSold(days);
  const byQ: Record<string, { dom: number[]; dec: number[] }> = {};
  for (const r of rows) {
    const dom = domDays(r);
    if (dom < 3) continue; // exclut « vendu dès la 1re vue » (bruit, âge inconnu)
    const slug = quartierSlug(r.commune) || "lux-ville";
    (byQ[slug] ||= { dom: [], dec: [] }).dom.push(dom);
    const d = decotePct(r);
    if (d != null) byQ[slug].dec.push(d);
  }
  return Object.entries(byQ)
    .map(([slug, v]) => {
      const md = median(v.dom);
      const mdec = median(v.dec);
      return {
        slug,
        count: v.dom.length,
        medianDays: md != null ? Math.round(md) : null,
        medianDecote: mdec != null ? Math.round(mdec * 10) / 10 : null,
      };
    })
    .sort((a, b) => b.count - a.count);
}

export type SoldItem = {
  id: string;
  title: string | null;
  url: string | null;
  commune: string | null;
  surface: number | null;
  soldPrice: number | null;
  firstPrice: number | null;
  days: number;
  decote: number | null;
  tracked: boolean;
  source: string | null;
  soldAt: string;
};

/** Flux des biens récemment partis (vendus / retirés), les plus récents d'abord. */
export async function getRecentSold(limit = 50): Promise<SoldItem[]> {
  await ensureSchema();
  const rows = await fetchSold(120);
  return rows.slice(0, limit).map((r) => ({
    id: r.id,
    title: r.title,
    url: r.url,
    commune: r.commune,
    surface: r.surface,
    soldPrice: r.sold_price,
    firstPrice: r.first_price,
    days: Math.max(0, Math.round(domDays(r))),
    decote: decotePct(r),
    tracked: r.tracked,
    source: r.source,
    soldAt: r.sold_at,
  }));
}
