// Moteur de scoring. 100% deterministe, aucune dependance.
// S4 : le prix de revente au m2 ne fait plus partie des parametres de la config.
// C'est une donnee de marche, calibree par zone (page Reglages) et resolue cote
// /api/ingest selon le quartier du bien, puis injectee ici via `resalePerM2`.
// La marge reste BRUTE (avant impot) — pas d'IS dans le modele BBI.

export type ScoringParams = {
  worksEurPerM2: number;    // cout de renovation estime au m2 (HT)
  worksVatPct: number;      // S4 — TVA travaux NON recuperable, ex: 0.17
  notaryPct: number;        // frais d'acquisition (droits + notaire), ex: 0.08
  resaleAgencyPct: number;  // frais a la revente (agence + divers), ex: 0.03
  targetMarginPct: number;  // marge brute cible sur capital investi, ex: 0.15
};

// S9 — Jeu d'hypotheses complet stocke par bien suivi : parametres de scoring
// + prix de revente au m2 (capture de la recherche, ou modifie pour un essai).
export type ScoringSnapshot = ScoringParams & { resalePerM2: number };

export type Listing = {
  id: string;
  url: string;
  title?: string;
  price: number;       // prix affiche
  surface: number;     // m2
  commune?: string;    // ex: "Luxembourg-Limpertsberg" — sert a resoudre le quartier
  cpe?: string;        // classe energetique (A..I)
  rooms?: number;
  /** S8 — URLs des photos de l'annonce (extraites par n8n, max 6). */
  photos?: string[];
  /** S10 — coordonnées précises atHome + adresse (carte). */
  lat?: number | null;
  lng?: number | null;
  address?: string | null;
  /** S12 — description de l'annonce (relevé de marché, runs is_survey). */
  description?: string | null;
};

export type Scored = Listing & {
  resalePerM2: number;      // S4 — prix de revente au m2 reellement applique
  priceIsDefault: boolean;  // S4 — true si prix issu du defaut (quartier non calibre)
  resaleValue: number;
  worksCost: number;        // TTC (TVA incluse)
  acquisitionCost: number;
  resaleCost: number;
  totalInvested: number;
  netProfit: number;        // benefice brut
  marginPct: number;        // marge brute / capital investi (en %, 1 decimale)
  maxBuyPrice: number;      // prix d'achat max pour atteindre la marge cible
  verdict: "GO" | "NEGOCIER" | "PASS";
  // Hypotheses (%) reellement appliquees — pour les afficher dans le detail.
  worksVatPct: number;
  notaryPct: number;
  resaleAgencyPct: number;
  // S5 — variation vs derniere vue : negatif = baisse (signal nego), null = premiere apparition.
  // Valeur initiale null ; ecrasee par /api/ingest apres lookup DB.
  priceDelta: number | null;
};

/**
 * Score un bien.
 * @param resalePerM2   prix de revente au m2 resolu pour le quartier du bien
 * @param priceIsDefault true si ce prix vient du defaut (quartier non calibre)
 */
export function scoreListing(
  l: Listing,
  p: ScoringParams,
  resalePerM2: number,
  priceIsDefault: boolean
): Scored {
  const resaleValue = l.surface * resalePerM2;
  const worksCost = l.surface * p.worksEurPerM2 * (1 + p.worksVatPct);
  const acquisitionCost = l.price * p.notaryPct;
  const resaleCost = resaleValue * p.resaleAgencyPct;

  const totalInvested = l.price + acquisitionCost + worksCost;
  const resaleNet = resaleValue - resaleCost;
  const netProfit = resaleNet - totalInvested;
  const marginPct = totalInvested > 0 ? netProfit / totalInvested : 0;

  // Prix d'achat max pour atteindre exactement la marge cible :
  // resaleNet = totalInvested*(1+target) ; totalInvested = x*(1+notary) + works
  // => x = (resaleNet/(1+target) - works) / (1+notary)
  const investedTarget = resaleNet / (1 + p.targetMarginPct);
  const maxBuyPrice = (investedTarget - worksCost) / (1 + p.notaryPct);

  let verdict: Scored["verdict"];
  if (marginPct >= p.targetMarginPct) verdict = "GO";
  else if (marginPct >= p.targetMarginPct * 0.5) verdict = "NEGOCIER";
  else verdict = "PASS";

  const round = (n: number) => Math.round(n);
  return {
    ...l,
    resalePerM2: round(resalePerM2),
    priceIsDefault,
    resaleValue: round(resaleValue),
    worksCost: round(worksCost),
    acquisitionCost: round(acquisitionCost),
    resaleCost: round(resaleCost),
    totalInvested: round(totalInvested),
    netProfit: round(netProfit),
    marginPct: Math.round(marginPct * 1000) / 10,
    maxBuyPrice: round(maxBuyPrice),
    verdict,
    worksVatPct: p.worksVatPct,
    notaryPct: p.notaryPct,
    resaleAgencyPct: p.resaleAgencyPct,
    priceDelta: null, // ecrase par /api/ingest
  };
}

export const DEFAULT_SCORING: ScoringParams = {
  worksEurPerM2: 1500,
  worksVatPct: 0.17,
  notaryPct: 0.08,
  resaleAgencyPct: 0.03,
  targetMarginPct: 0.15,
};
