// Auth minimaliste : un seul mot de passe partage (APP_PASSWORD).
// Le cookie de session = HMAC-SHA256(SESSION_SECRET, "scout-ok"), en base64url.
// On utilise Web Crypto (crypto.subtle) qui marche a la fois sur l'edge
// (middleware) et sur le runtime Node (routes API). Aucune dependance.

const enc = new TextEncoder();

function base64url(bytes: ArrayBuffer): string {
  const b = Buffer.from(new Uint8Array(bytes)).toString("base64");
  return b.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sessionToken(): Promise<string> {
  const secret = process.env.SESSION_SECRET || "";
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode("scout-ok"));
  return base64url(sig);
}

export async function isValidSession(cookieValue: string | undefined): Promise<boolean> {
  if (!cookieValue) return false;
  const expected = await sessionToken();
  // Comparaison a temps constant approximative (longueurs egales attendues)
  if (cookieValue.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= cookieValue.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

export const SESSION_COOKIE = "scout_session";
