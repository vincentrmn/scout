// S12 — Génération des propositions de prix de revente par quartier.
// Méthode : comps terrain (market_samples 12 sem.) -> prix affiché cible
// (rénové médiane / P75 / cluster / ville) × (1 − décote), arrondi 50 € inf.
import { pool } from "@/lib/db";
import { getDecote, type Decote } from "@/lib/observatoire";

// Clusters de repli (slugs de zones). Modifiables.
export const CLUSTERS: string[][] = [
  ["bonnevoie", "gare", "hollerich"],
  ["belair", "merl", "limpertsberg"],
  ["eich", "beggen", "dommeldange", "muhlenbach", "weimerskirch"],
  ["neudorf", "clausen", "cents", "hamm", "pulvermuhle", "weimershof"],
  ["gasperich", "cessange"],
  ["centre-ville", "grund", "pfaffenthal"],
  ["kirchberg"],
  ["rollingergrund", "muhlenbach"],
];

function clusterOf(slug: string): string[] | null {
  return CLUSTERS.find((c) => c.includes(slug)) ?? null;
}

type Comp = {
  listing_id: string;
  quartier_slug: string;
  price: number;
  surface: number;
  price_m2: number;
  cpe: string | null;
  etat: string | null;
  etat_confidence: number | null;
  url: string | null;
  observed_at: string;
};

async function loadComps(): Promise<Comp[]> {
  const { rows } = await pool.query<Comp>(`
    SELECT DISTINCT ON (listing_id)
      listing_id, quartier_slug, price,
      surface::float AS surface, price_m2::float AS price_m2,
      cpe, etat, etat_confidence::float AS etat_confidence, url, observed_at
    FROM market_samples
    WHERE observed_at > now() - interval '84 days'
      AND surface BETWEEN 30 AND 70
      AND (cpe IS NULL OR cpe IN ('C','D','E','F'))
      AND price_m2 IS NOT NULL
    ORDER BY listing_id, observed_at DESC
  `);
  return rows;
}

function pct(values: number[], p: number): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const idx = (p / 100) * (s.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

// Applique la règle "rénové médiane (≥8) sinon P75 tous (≥12)" sur un jeu de comps.
function applyRule(comps: Comp[]): { value: number; basis: "renove" | "p75"; used: Comp[] } | null {
  const renove = comps.filter((c) => c.etat === "renove");
  if (renove.length >= 8) {
    const v = pct(renove.map((c) => c.price_m2), 50);
    if (v != null) return { value: v, basis: "renove", used: renove };
  }
  if (comps.length >= 12) {
    const v = pct(comps.map((c) => c.price_m2), 75);
    if (v != null) return { value: v, basis: "p75", used: comps };
  }
  return null;
}

const floor50 = (n: number) => Math.floor(n / 50) * 50;

function compDetail(c: Comp) {
  return {
    listing_id: c.listing_id,
    url: c.url,
    price: c.price,
    surface: c.surface,
    price_m2: Math.round(c.price_m2),
    cpe: c.cpe,
    etat: c.etat,
    etat_confidence: c.etat_confidence,
    observed_at: c.observed_at,
  };
}

export type ProposalCalc = {
  level: "quartier_renove" | "quartier_p75" | "cluster" | "ville";
  basis: "renove" | "p75";
  n_used: number;
  cible_eur_m2: number;
  percentiles: { p25: number | null; median: number | null; p75: number | null };
  decote: Decote;
  proposed_eur_m2: number;
  current_eur_m2: number | null;
  formula: string;
  comps: ReturnType<typeof compDetail>[];
  generated_at: string;
};

/** Calcule la proposition d'un quartier (ou null si aucun comp exploitable). */
export function computeQuartier(
  slug: string,
  comps: Comp[],
  decote: Decote,
  current: number | null
): { proposed: number; calc: ProposalCalc } | null {
  const here = comps.filter((c) => c.quartier_slug === slug);

  let level: ProposalCalc["level"];
  let r = applyRule(here);
  let used: Comp[];
  let cible: number;
  let basis: "renove" | "p75";

  if (r) {
    level = r.basis === "renove" ? "quartier_renove" : "quartier_p75";
    used = r.used; cible = r.value; basis = r.basis;
  } else {
    const cl = clusterOf(slug);
    const clusterComps = cl ? comps.filter((c) => cl.includes(c.quartier_slug)) : [];
    const rc = cl ? applyRule(clusterComps) : null;
    if (rc) {
      level = "cluster"; used = rc.used; cible = rc.value; basis = rc.basis;
    } else {
      // Ville : P75 de tous les comps (dernier recours).
      const v = pct(comps.map((c) => c.price_m2), 75);
      if (v == null) return null;
      level = "ville"; used = comps; cible = v; basis = "p75";
    }
  }

  const proposed = floor50(cible * (1 - decote.decote));
  const usedM2 = used.map((c) => c.price_m2);
  const percentiles = { p25: round(pct(usedM2, 25)), median: round(pct(usedM2, 50)), p75: round(pct(usedM2, 75)) };

  const fmtEur = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const cibleLabel = basis === "renove" ? `médiane rénové (n=${used.length})` : `P75 (n=${used.length})`;
  const formula =
    `${cibleLabel} = ${fmtEur(cible)} €/m² × (1 − ${Math.round(decote.decote * 1000) / 10} %` +
    `${decote.source === "fallback" ? " fallback" : ""}) = ${fmtEur(cible * (1 - decote.decote))} → arrondi ${fmtEur(proposed)} €/m²`;

  const calc: ProposalCalc = {
    level, basis, n_used: used.length, cible_eur_m2: Math.round(cible),
    percentiles, decote, proposed_eur_m2: proposed, current_eur_m2: current,
    formula, comps: used.map(compDetail), generated_at: new Date().toISOString(),
  };
  return { proposed, calc };
}

function round(n: number | null): number | null {
  return n == null ? null : Math.round(n);
}

/** Régénère les propositions pending pour tous les quartiers (diff ≥ 2 %). */
export async function generateProposals(): Promise<{ created: number; total: number }> {
  const decote = await getDecote();
  const comps = await loadComps();

  // quartiers + prix courant (zones).
  const { rows: zones } = await pool.query<{ id: string; resale: string | null }>(
    `SELECT id, resale_eur_per_m2::float AS resale FROM zones WHERE parent_id IS NOT NULL`
  );
  const cityRow = await pool.query<{ resale: string | null }>(
    `SELECT resale_eur_per_m2::float AS resale FROM zones WHERE parent_id IS NULL LIMIT 1`
  );
  const cityDefault = cityRow.rows[0]?.resale != null ? Number(cityRow.rows[0].resale) : 11000;

  let created = 0;
  for (const z of zones) {
    const current = z.resale != null ? Number(z.resale) : cityDefault;
    const res = computeQuartier(z.id, comps, decote, current);
    if (!res) continue;
    const diff = current > 0 ? Math.abs(res.proposed - current) / current : 1;
    if (diff < 0.02) continue;
    await pool.query(`DELETE FROM price_proposals WHERE quartier_slug=$1 AND status='pending'`, [z.id]);
    await pool.query(
      `INSERT INTO price_proposals (quartier_slug, proposed_eur_m2, current_eur_m2, calc, status)
       VALUES ($1, $2, $3, $4, 'pending')`,
      [z.id, res.proposed, Math.round(current), JSON.stringify(res.calc)]
    );
    created++;
  }
  return { created, total: zones.length };
}
