"use client";
import { useEffect, useState } from "react";

type Velocity = { slug: string; count: number; medianDays: number | null; medianDecote: number | null };
type SoldItem = {
  id: string; title: string | null; url: string | null; commune: string | null;
  surface: number | null; exitPrice: number | null; firstPrice: number | null;
  days: number; decote: number | null; tracked: boolean; source: string | null;
  status: string; leftAt: string;
};
type Payload = { velocity: Velocity[]; recent: SoldItem[]; labels: Record<string, string> };

const eur = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".") + " €";
const weeks = (d: number) => `${(d / 7).toFixed(1)} sem`;

export default function MarchePage() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/market")
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
        return r.json();
      })
      .then(setData)
      .catch((e) => setError(e?.message ?? "Erreur"));
  }, []);

  const hasData = data && (data.velocity.length > 0 || data.recent.length > 0);

  return (
    <div className="wrap">
      <div className="topbar">
        <a className="brand-home" href="/" title="Accueil">SCOUT</a>
        <h1 className="page-title">Marché</h1>
        <div className="topbar-nav">
          <a className="btn ghost" href="/">← Retour</a>
        </div>
      </div>

      {!data && !error && <p className="empty">Chargement…</p>}
      {error && (
        <div className="card"><p className="error" style={{ margin: 0 }}>Erreur : {error}</p></div>
      )}

      {data && !hasData && (
        <p className="empty">
          Pas encore de données. Dès qu'un bien repéré par les relevés est « vendu » (atHome) ou disparaît
          (atHome + Immotop), il est enregistré ici (durée, décote). Ça se construit au fil des jours — reviens bientôt.
        </p>
      )}

      {hasData && (
        <>
          {/* --- Vélocité par quartier --- */}
          {data!.velocity.length > 0 && (
            <>
              <div className="section-title"><h2>Vélocité par quartier</h2><span className="rule" /></div>
              <p className="muted" style={{ fontSize: "0.82rem", marginBottom: 12 }}>
                Sur les biens partis ces 120 derniers jours. Durée = depuis la 1re fois qu'on a vu le bien (borne basse).
              </p>
              <div className="card" style={{ padding: 0, overflowX: "auto" }}>
                <table className="prop-table">
                  <thead>
                    <tr>
                      <th>Quartier</th>
                      <th className="num">Délai médian</th>
                      <th className="num">Décote médiane</th>
                      <th className="num">Biens partis</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data!.velocity.map((v) => (
                      <tr key={v.slug}>
                        <td className="cell-main">{data!.labels[v.slug] ?? v.slug}</td>
                        <td className="num" data-label="Délai médian">{v.medianDays != null ? weeks(v.medianDays) : "—"}</td>
                        <td className="num" data-label="Décote médiane">{v.medianDecote != null ? `−${v.medianDecote}%` : "—"}</td>
                        <td className="num" data-label="Biens partis">{v.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* --- Flux des biens partis --- */}
          {data!.recent.length > 0 && (
            <>
              <div className="section-title" style={{ marginTop: 26 }}><h2>Partis récemment</h2><span className="rule" /></div>
              <div className="card" style={{ padding: 0, overflowX: "auto" }}>
                <table className="prop-table">
                  <thead>
                    <tr>
                      <th>Bien</th>
                      <th>Statut</th>
                      <th className="num">Prix de sortie</th>
                      <th className="num">m²</th>
                      <th className="num">Sur le marché</th>
                      <th className="num">Décote</th>
                      <th>Le</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data!.recent.map((s) => (
                      <tr key={s.id}>
                        <td className="cell-main">
                          {s.url ? (
                            <a href={s.url} target="_blank" rel="noreferrer">{s.title || s.id}</a>
                          ) : (
                            s.title || s.id
                          )}
                          {s.tracked && <span className="src-badge" title="Bien que tu suivais">★ suivi</span>}
                          {s.commune && <div className="muted" style={{ fontSize: "0.78rem" }}>{s.commune}</div>}
                        </td>
                        <td data-label="Statut">
                          <span className={`etat-badge ${s.status === "sold" ? "renove" : "a_renover"}`} title={s.status === "sold" ? "Marqué vendu sur atHome" : "Disparu des relevés (présumé parti)"}>
                            {s.status === "sold" ? "Vendu" : "Parti"}
                          </span>
                        </td>
                        <td className="num" data-label="Prix de sortie">{s.exitPrice != null ? eur(s.exitPrice) : "—"}</td>
                        <td className="num" data-label="m²">{s.surface ?? "—"}</td>
                        <td className="num" data-label="Sur le marché">{s.days >= 3 ? `${s.days} j` : "—"}</td>
                        <td className="num" data-label="Décote">{s.decote != null && s.decote !== 0 ? `−${s.decote}%` : "—"}</td>
                        <td data-label="Le"><span className="muted" style={{ fontSize: "0.82rem" }}>{new Date(s.leftAt).toLocaleDateString("fr-FR")}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
