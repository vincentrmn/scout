// Moteur de scoring achat-revente. 100% deterministe, aucune dependance.
// Tous les parametres viennent de la "scoring config" stockee avec la recherche,
// pour que tu puisses les calibrer sans toucher au code.

export type ScoringParams = {
  resaleEurPerM2: number;   // prix de revente cible au m2 (apres travaux), a calibrer par zone
  worksEurPerM2: number;    // cout de renovation estime au m2
  notaryPct: number;        // frais d'acquisition (notaire + enregistrement), ex: 0.07
  resaleAgencyPct: number;  // frais a la revente (agence + divers), ex: 0.03
  targetMarginPct: number;  // marge nette cible sur capital investi, ex: 0.20
};

export type Listing = {
  id: string;
  url: string;
  title?: string;
  price: number;       // prix affiche
  surface: number;     // m2
  commune?: string;
  cpe?: string;        // classe energetique (A..I)
  rooms?: number;
};

export type Scored = Listing & {
  resaleValue: number;
  worksCost: number;
  acquisitionCost: number;
  resaleCost: number;
  totalInvested: number;
  netProfit: number;
  marginPct: number;        // marge nette / capital investi
  maxBuyPrice: number;      // prix d'achat max pour atteindre la marge cible
  verdict: "GO" | "NEGOCIER" | "PASS";
};

export function scoreListing(l: Listing, p: ScoringParams): Scored {
  const resaleValue = l.surface * p.resaleEurPerM2;
  const worksCost = l.surface * p.worksEurPerM2;
  const acquisitionCost = l.price * p.notaryPct;
  const resaleCost = resaleValue * p.resaleAgencyPct;

  const totalInvested = l.price + acquisitionCost + worksCost;
  const resaleNet = resaleValue - resaleCost;
  const netProfit = resaleNet - totalInvested;
  const marginPct = totalInvested > 0 ? netProfit / totalInvested : 0;

  // Prix d'achat max pour atteindre exactement la marge cible :
  // on veut netProfit = target * totalInvested, soit resaleNet = totalInvested*(1+target)
  // totalInvested = x*(1+notary) + works  =>  x = (resaleNet/(1+target) - works) / (1+notary)
  const investedTarget = resaleNet / (1 + p.targetMarginPct);
  const maxBuyPrice = (investedTarget - worksCost) / (1 + p.notaryPct);

  let verdict: Scored["verdict"];
  if (marginPct >= p.targetMarginPct) verdict = "GO";
  else if (marginPct >= p.targetMarginPct * 0.5) verdict = "NEGOCIER";
  else verdict = "PASS";

  const round = (n: number) => Math.round(n);
  return {
    ...l,
    resaleValue: round(resaleValue),
    worksCost: round(worksCost),
    acquisitionCost: round(acquisitionCost),
    resaleCost: round(resaleCost),
    totalInvested: round(totalInvested),
    netProfit: round(netProfit),
    marginPct: Math.round(marginPct * 1000) / 10, // en %, 1 decimale
    maxBuyPrice: round(maxBuyPrice),
    verdict,
  };
}

export const DEFAULT_SCORING: ScoringParams = {
  resaleEurPerM2: 11000, // a calibrer : Lux-ville ancien renove, ordre de grandeur
  worksEurPerM2: 1500,
  notaryPct: 0.07,
  resaleAgencyPct: 0.03,
  targetMarginPct: 0.2,
};
