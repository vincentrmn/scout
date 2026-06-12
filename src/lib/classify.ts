// S12 — Classification de l'état intérieur d'un appartement à partir de sa
// description d'annonce, via Claude Haiku. Clé ANTHROPIC_API_KEY (Railway).

export type EtatResult = { etat: "a_renover" | "habitable" | "renove"; confidence: number | null };

const SYSTEM = `Tu classifies l'état intérieur d'un appartement à partir de sa description d'annonce immobilière luxembourgeoise (FR/EN/DE possibles). Réponds UNIQUEMENT un JSON {"etat":"a_renover|habitable|renove","confidence":0.0-1.0}. renove = entièrement rénové/refait à neuf récemment, cuisine/SDB neuves, « rénové avec goût », « refait à neuf », « renovated », « komplett renoviert ». a_renover = travaux à prévoir, à rafraîchir, potentiel, « to renovate ». habitable = bon état général sans rénovation récente complète, ou description ambiguë. En cas de doute entre renove et habitable, choisis habitable (prudence).`;

/**
 * Classifie une description. Retourne null si pas de clé API, description vide,
 * ou réponse inexploitable. Lève en cas d'erreur HTTP (le caller gère par bien).
 */
export async function classifyEtat(description: string): Promise<EtatResult | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  const text = (description || "").trim();
  if (!key || !text) return null;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 60,
      system: SYSTEM,
      messages: [{ role: "user", content: text.slice(0, 2000) }],
    }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}`);
  const data = await res.json();
  const out = data?.content?.[0]?.text ?? "";
  const m = out.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let parsed: any;
  try {
    parsed = JSON.parse(m[0]);
  } catch {
    return null;
  }
  const etat = ["a_renover", "habitable", "renove"].includes(parsed?.etat) ? parsed.etat : "habitable";
  const confidence = typeof parsed?.confidence === "number" ? parsed.confidence : null;
  return { etat, confidence };
}

export const hasAnthropicKey = () => !!process.env.ANTHROPIC_API_KEY;
