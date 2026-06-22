// S12/S16 — Génération des propositions de prix de revente par quartier.
// Méthode (révisée S16) : le prix de revente = MÉDIANE DES BIENS RÉNOVÉS du
// quartier (la seule vraie preuve « à combien se revend un bien refait »).
// Plus de P75-de-tout (qui était gonflé par le luxe/neuf/indéterminés).
// Repli si < 3 rénovés : rénovés du cluster voisin -> référence Observatoire.
// Sinon : pas de proposition (mieux vaut rien qu'un prix faux). × (1 − décote).
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

const RENOVE_MIN = 3; // seuil : 3 rénovés suffisent pour faire foi.

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
      -- S16 : on écarte les « indéterminés » (ni CPE ni état) qui polluent
      -- (surtout des biens Immotop sans note, souvent haut de gamme).
      AND NOT (cpe IS NULL AND etat IS NULL)
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

// S16 — médiane des rénovés (≥ RENOVE_MIN), sinon null. C'est LA base du prix.
function renoveMedian(comps: Comp[]): { value: number; used: Comp[] } | null {
  const renove = comps.filter((c) => c.etat === "renove");
  if (renove.length >= RENOVE_MIN) {
    const v = pct(renove.map((c) => c.price_m2), 50);
    if (v != null) return { value: v, used: renove };
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
  level: "quartier_renove" | "cluster" | "vdl";
  basis: "renove" | "reference";
  n_used: number;
  cible_eur_m2: number;
  percentiles: { p25: number | null; median: number | null; p75: number | null };
  decote: Decote;
  proposed_eur_m2: number;
  current_eur_m2: number | null;
  vdl_ref: number | null;
  confidence: number;
  confidence_reason: string;
  formula: string;
  comps: ReturnType<typeof compDetail>[];
  generated_at: string;
};

// Note de confiance 0–100 = base(niveau) × taille(n) × dispersion × décote.
function computeConfidence(
  level: ProposalCalc["level"],
  basis: "renove" | "reference",
  n: number,
  pctl: { p25: number | null; median: number | null; p75: number | null },
  decote: Decote
): { confidence: number; confidence_reason: string } {
  const BASE: Record<ProposalCalc["level"], number> = {
    quartier_renove: 92, cluster: 65, vdl: 55,
  };
  const base = BASE[level] ?? 50;

  let fN = 1;
  if (basis === "renove") {
    fN = Math.max(0.6, Math.min(1, 0.6 + 0.4 * Math.min(1, n / 8)));
  }

  let fDisp = 1;
  if (pctl.median && pctl.p25 != null && pctl.p75 != null && pctl.median > 0) {
    const spread = (pctl.p75 - pctl.p25) / pctl.median;
    fDisp = Math.max(0.7, Math.min(1, 1 - Math.max(0, spread - 0.15) * 0.8));
  }

  const fDecote = decote.source === "computed" ? 1 : 0.85;
  const confidence = Math.round(Math.max(0, Math.min(100, base * fN * fDisp * fDecote)));

  const levelLabel =
    level === "quartier_renove" ? "médiane rénové"
    : level === "cluster" ? "médiane rénové (cluster)"
    : "réf Observatoire";
  const parts = [levelLabel];
  if (basis === "renove") parts.push(`${n} rénovés`);
  if (fDisp < 0.95) parts.push("dispersion large");
  if (fDecote < 1) parts.push("décote fallback");
  return { confidence, confidence_reason: parts.join(" · ") };
}

/** Calcule la proposition d'un quartier (ou null si aucune base fiable). */
export function computeQuartier(
  slug: string,
  comps: Comp[],
  decote: Decote,
  current: number | null,
  announcedRef: number | null
): { proposed: number; calc: ProposalCalc } | null {
  const here = comps.filter((c) => c.quartier_slug === slug);

  let level: ProposalCalc["level"];
  let used: Comp[];
  let cible: number;
  let basis: "renove" | "reference";

  const rq = renoveMedian(here);
  if (rq) {
    level = "quartier_renove"; used = rq.used; cible = rq.value; basis = "renove";
  } else {
    const cl = clusterOf(slug);
    const rc = cl ? renoveMedian(comps.filter((c) => cl.includes(c.quartier_slug))) : null;
    if (rc) {
      level = "cluster"; used = rc.used; cible = rc.value; basis = "renove";
    } else if (announcedRef != null && announcedRef > 0) {
      level = "vdl"; used = []; cible = announcedRef; basis = "reference";
    } else {
      // Aucune base fiable (pas de rénovés, pas de réf) -> pas de proposition.
      return null;
    }
  }

  const proposed = floor50(cible * (1 - decote.decote));
  const usedM2 = used.map((c) => c.price_m2);
  const percentiles = { p25: round(pct(usedM2, 25)), median: round(pct(usedM2, 50)), p75: round(pct(usedM2, 75)) };

  const fmtEur = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const cibleLabel =
    basis === "renove"
      ? `médiane rénové (n=${used.length}${level === "cluster" ? ", cluster" : ""})`
      : `référence Observatoire`;
  const formula =
    `${cibleLabel} = ${fmtEur(cible)} €/m² × (1 − ${Math.round(decote.decote * 1000) / 10} %` +
    `${decote.source === "fallback" ? " fallback" : ""}) = ${fmtEur(cible * (1 - decote.decote))} → arrondi ${fmtEur(proposed)} €/m²`;

  const conf = computeConfidence(level, basis, used.length, percentiles, decote);

  const calc: ProposalCalc = {
    level, basis, n_used: used.length, cible_eur_m2: Math.round(cible),
    percentiles, decote, proposed_eur_m2: proposed, current_eur_m2: current,
    vdl_ref: announcedRef,
    confidence: conf.confidence, confidence_reason: conf.confidence_reason,
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
  const rawComps = await loadComps();

  const { rows: allZones } = await pool.query<{ id: string; parent_id: string | null; resale: string | null; announced: string | null }>(
    `SELECT id, parent_id, resale_eur_per_m2::float AS resale, announced_eur_per_m2::float AS announced FROM zones`
  );
  const cityZone = allZones.find((z) => z.parent_id == null);
  const cityDefault = cityZone?.resale != null ? Number(cityZone.resale) : 11000;

  // S16 — Plafond anti-neuf/luxe : un comp affiché au-dessus de la réf Observatoire
  // du quartier × 1,45 n'est PAS un comparable de revente rénové (c'est du neuf ou
  // du haut de gamme — le flag isNew d'Immotop étant peu fiable, on filtre par PRIX,
  // qui ne ment pas). Garde-fou robuste, indépendant des flags.
  const CAP = 1.35;
  const refMap = new Map<string, number>();
  for (const z of allZones) if (z.announced != null && Number(z.announced) > 0) refMap.set(z.id, Number(z.announced));
  const cityRef = cityZone?.announced != null ? Number(cityZone.announced) : null;
  const comps = rawComps.filter((c) => {
    const ref = refMap.get(c.quartier_slug) ?? cityRef;
    return !ref || c.price_m2 <= ref * CAP;
  });

  let created = 0;
  for (const z of allZones) {
    const current = z.resale != null ? Number(z.resale) : cityDefault;
    const announcedRef = z.announced != null ? Number(z.announced) : null;
    const res = computeQuartier(z.id, comps, decote, current, announcedRef);
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
  return { created, total: allZones.length };
}
