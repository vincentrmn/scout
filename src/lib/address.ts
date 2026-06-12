// S10 — Adresse atHome : parfois "NC"/"" alors que des coordonnées (centroïde
// de quartier) sont quand même fournies. On ne considère avoir la "vraie"
// localisation que si une rue est communiquée. Sert à distinguer, sur la carte,
// un pin "adresse exacte" d'un pin "quartier".
const PLACEHOLDERS = new Set([
  "nc", "n/a", "na", "n.c.", "-", "—", "non communiqué", "non communique",
]);

export function realAddress(a?: string | null): string | null {
  const s = (a ?? "").trim();
  if (!s) return null;
  if (PLACEHOLDERS.has(s.toLowerCase())) return null;
  return s;
}
