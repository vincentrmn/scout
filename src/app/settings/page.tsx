"use client";
import { useEffect, useMemo, useState } from "react";

type Zone = {
  id: string;
  label: string;
  resale_eur_per_m2: number | null;
};
type ZoneTree = Zone & { quartiers: Zone[] };

export default function SettingsPage() {
  const [tree, setTree] = useState<ZoneTree[]>([]);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/zone-prices", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const t: ZoneTree[] = json.zones || [];
        setTree(t);
        const v: Record<string, string> = {};
        for (const city of t) {
          v[city.id] = city.resale_eur_per_m2 != null ? String(city.resale_eur_per_m2) : "";
          for (const q of city.quartiers) {
            v[q.id] = q.resale_eur_per_m2 != null ? String(q.resale_eur_per_m2) : "";
          }
        }
        setVals(v);
      } catch (e) {
        setMsg({ kind: "err", text: "Impossible de charger les prix." });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Le prix par defaut est porte par la ville (1ʳᵉ ville de l'arbre).
  const defaultPrice = useMemo(() => {
    const city = tree[0];
    if (!city) return 0;
    const raw = vals[city.id];
    return raw && raw.trim() !== "" ? Number(raw) : 0;
  }, [tree, vals]);

  function set(id: string, value: string) {
    setVals((p) => ({ ...p, [id]: value }));
    setMsg(null);
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    const prices: Record<string, number | null> = {};
    for (const [id, v] of Object.entries(vals)) {
      prices[id] = v.trim() === "" ? null : Number(v);
    }
    const res = await fetch("/api/zone-prices", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prices }),
    });
    setBusy(false);
    if (res.ok) setMsg({ kind: "ok", text: "Prix enregistrés." });
    else {
      const d = await res.json().catch(() => ({}));
      setMsg({ kind: "err", text: d.error || "Erreur à l'enregistrement." });
    }
  }

  return (
    <div className="wrap">
      <div className="topbar">
        <a className="brand-home" href="/" title="Accueil">SCOUT</a>
        <h1 className="page-title">Prix de revente</h1>
        <div className="topbar-nav">
          <a className="btn ghost" href="/">← Retour</a>
        </div>
      </div>

      <p className="muted" style={{ marginTop: 0 }}>
        Prix de revente cible au m² par quartier, utilisés pour scorer chaque bien. Un quartier
        laissé vide hérite du prix par défaut. Ces prix s'appliquent au prochain run.
      </p>

      {loading && <p className="empty">Chargement…</p>}

      {!loading &&
        tree.map((city) => (
          <div key={city.id} style={{ marginBottom: 22 }}>
            <div className="card">
              <label>Prix par défaut — {city.label} (€/m²)</label>
              <input
                type="number"
                value={vals[city.id] ?? ""}
                onChange={(e) => set(city.id, e.target.value)}
                placeholder="ex : 11000"
                style={{ maxWidth: 220 }}
              />
              <p className="muted" style={{ fontSize: "0.8rem", marginBottom: 0, marginTop: 8 }}>
                Appliqué à tout quartier non calibré ci-dessous.
              </p>
            </div>

            <div className="section-title">
              <h2>Quartiers</h2>
              <span className="rule" />
            </div>

            <div className="card">
              <div className="grid cols-2">
                {city.quartiers.map((q) => (
                  <div key={q.id}>
                    <label>{q.label} (€/m²)</label>
                    <input
                      type="number"
                      value={vals[q.id] ?? ""}
                      onChange={(e) => set(q.id, e.target.value)}
                      placeholder={defaultPrice ? `défaut : ${defaultPrice}` : "défaut"}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}

      {msg && (
        <div className={msg.kind === "err" ? "error" : ""} style={msg.kind === "ok" ? { color: "var(--green-ink)", fontWeight: 600 } : undefined}>
          {msg.text}
        </div>
      )}

      <div className="row" style={{ marginTop: 18 }}>
        <button className="btn clay" onClick={save} disabled={busy || loading}>
          {busy ? "..." : "Enregistrer les prix"}
        </button>
      </div>
    </div>
  );
}
