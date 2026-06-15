import { pool, ensureSchema } from "./db";
import { quartierSlug } from "./zones";

// S15/S16 — Vélocité de marché. Biens « partis » = market_status 'sold' (flag
// vendu atHome, haute confiance) OU 'gone' (vu dans les relevés larges puis
// absent ≥3 j, présumé parti — vaut aussi pour Immotop). On en tire par quartier
// la durée de vente médiane et la décote médiane (1er prix vu → prix de sortie).
// Caveat : first_seen = 1re fois où NOUS avons vu le bien (borne basse de l'âge réel).

type SoldRow = {
  id: string;
  commune: string | null;
  market_status: string;
  left_at: string;
  first_seen: string;
  exit_price: number | null;
  first_price: number | null;
  title: string | null;
  url: string | null;
  surface: number | null;
  tracked: boolean;
  source: string | null;
};

async function fetchSold(days: number): Promise<SoldRow[]> {
  const { rows } = await pool.query<SoldRow>(
    `SELECT l.id, l.commune, l.market_status,
            COALESCE(l.sold_at, l.gone_at) AS left_at,
            l.first_seen,
            COALESCE(l.sold_price, l.price) AS exit_price,
            l.title, l.url, l.surface::float8 AS surface, l.tracked, l.source,
            (SELECT s.price FROM listing_snapshots s WHERE s.listing_id = l.id ORDER BY s.seen_at ASC LIMIT 1) AS first_price
       FROM listings l
      WHERE l.market_status IN ('sold','gone')
        AND COALESCE(l.sold_at, l.gone_at) > now() - make_interval(days => $1::int)
      ORDER BY COALESCE(l.sold_at, l.gone_at) DESC`,
    [days]
  );
  return rows;
}

const domDays = (r: SoldRow) =>
  (new Date(r.left_at).getTime() - new Date(r.first_seen).getTime()) / 86_400_000;

function decotePct(r: SoldRow): number | null {
  if (r.first_price && r.exit_price && r.first_price > 0) {
    return Math.round(((r.first_price - r.exit_price) / r.first_price) * 1000) / 10;
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

/** Stats de vélocité par quartier (biens partis, fenêtre `days`). */
export async function getVelocityByQuartier(days = 120): Promise<QuartierVelocity[]> {
  await ensureSchema();
  const rows = await fetchSold(days);
  const byQ: Record<string, { dom: number[]; dec: number[] }> = {};
  for (const r of rows) {
    const dom = domDays(r);
    if (dom < 3) continue; // exclut « parti dès la 1re vue » (bruit, âge inconnu)
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
  exitPrice: number | null;
  firstPrice: number | null;
  days: number;
  decote: number | null;
  tracked: boolean;
  source: string | null;
  status: string; // 'sold' (vendu confirmé) | 'gone' (disparu)
  leftAt: string;
};

/** Flux des biens récemment partis, les plus récents d'abord. */
export async function getRecentSold(limit = 60): Promise<SoldItem[]> {
  await ensureSchema();
  const rows = await fetchSold(120);
  return rows.slice(0, limit).map((r) => ({
    id: r.id,
    title: r.title,
    url: r.url,
    commune: r.commune,
    surface: r.surface,
    exitPrice: r.exit_price,
    firstPrice: r.first_price,
    days: Math.max(0, Math.round(domDays(r))),
    decote: decotePct(r),
    tracked: r.tracked,
    source: r.source,
    status: r.market_status,
    leftAt: r.left_at,
  }));
}
