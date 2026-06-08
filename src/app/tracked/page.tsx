"use client";
import { Fragment, useEffect, useState } from "react";

type Snapshot = { price: number; seen_at: string };

type TrackedListing = {
  id: string;
  url: string;
  title?: string;
  price: number;
  prev_price?: number | null;
  surface: number;
  commune?: string;
  cpe?: string;
  first_seen: string;
  last_seen: string;
  tracked_at?: string | null;
  price_delta?: number | null;
  // Re-scoring a la volee (DEFAULT_SCORING + prix zone) — pas de verdict.
  resalePerM2?: number;
  priceIsDefault?: boolean;
  resaleValue?: number;
  worksCost?: number;
  acquisitionCost?: number;
  resaleCost?: number;
  totalInvested?: number;
  netProfit?: number;
  marginPct?: number | null;
  maxBuyPrice?: number;
  // S6 Phase 1
  history?: Snapshot[];
};

const eur = (n: number) =>
  new Intl.NumberFormat("fr-FR").format(Math.round(n)) + " €";

const daysSince = (iso: string) =>
  Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);

function DetailRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "5px 0", borderBottom: "1px solid var(--line)" }}>
      <span className="muted" style={{ fontSize: "0.82rem" }}>
        {label}
        {hint && <span style={{ fontStyle: "italic", marginLeft: 6 }}>{hint}</span>}
      </span>
      <span className="mono" style={{ fontSize: "0.85rem" }}>{value}</span>
    </div>
  );
}

// Sparkline minimale, sans dependance. Vert BBI. Rien si < 2 points.
function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return null;
  const w = 240, h = 44, pad = 4;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const step = (w - pad * 2) / (points.length - 1);
  const coords = points
    .map((p, i) => {
      const x = pad + i * step;
      const y = pad + (h - pad * 2) * (1 - (p - min) / range);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
      <polyline
        points={coords}
        fill="none"
        stroke="var(--green)"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function TrackedPage() {
  const [listings, setListings] = useState<TrackedListing[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const load = async () => {
    setError(null);
    try {
      const res = await fetch("/api/listings?tracked=1");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const r = await res.json();
      setListings(Array.isArray(r) ? r : []);
    } catch (e: any) {
      setError(e?.message ?? "Erreur inconnue");
      setListings(null);
    }
  };

  useEffect(() => { load(); }, []);

  const toggle = (id: string) => setOpen((p) => ({ ...p, [id]: !p[id] }));

  const untrack = async (id: string) => {
    setListings((prev) => (prev ? prev.filter((x) => x.id !== id) : prev));
    await fetch("/api/listings/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, tracked: false }),
    }).catch(() => {});
  };

  return (
    <div className="wrap">
      <div className="topbar">
        <div className="brand">
          <span className="dot" />
          <h1>Suivis</h1>
        </div>
        <a className="btn ghost" href="/">← Retour</a>
      </div>

      {listings === null && error === null && <p className="empty">Chargement…</p>}

      {error !== null && (
        <div className="card">
          <p className="error" style={{ margin: 0 }}>Erreur : {error}</p>
          <button className="btn ghost" onClick={load} style={{ marginTop: 12 }}>Réessayer</button>
        </div>
      )}

      {listings !== null && listings.length === 0 && (
        <p className="empty">
          Aucun bien suivi pour l'instant. Étoilez des biens depuis une page de résultats.
        </p>
      )}

      {listings !== null && listings.length > 0 && (
        <>
          <p className="muted" style={{ fontSize: "0.82rem", marginBottom: 14 }}>
            Marge calculée avec les paramètres par défaut et le prix de revente de chaque zone.
          </p>
          <div className="card" style={{ padding: 0, overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th style={{ width: 28 }}></th>
                  <th>Bien</th>
                  <th className="num">Prix</th>
                  <th className="num">m²</th>
                  <th>CPE</th>
                  <th className="num">Marge</th>
                  <th>Dernière vue</th>
                  <th style={{ width: 36 }}></th>
                </tr>
              </thead>
              <tbody>
                {listings.map((l) => {
                  const age = daysSince(l.last_seen);
                  const stale = age > 30;
                  const isOpen = !!open[l.id];
                  const hasScore = l.marginPct != null && l.resaleValue != null;
                  const history = l.history ?? [];
                  return (
                    <Fragment key={l.id}>
                      <tr>
                        <td style={{ textAlign: "center" }}>
                          {hasScore && (
                            <span
                              role="button"
                              aria-label={isOpen ? "Replier" : "Détail"}
                              onClick={() => toggle(l.id)}
                              style={{ cursor: "pointer", userSelect: "none", color: "var(--ink-soft)", display: "inline-block", transform: isOpen ? "rotate(90deg)" : "none", transition: "transform 0.12s ease" }}
                            >
                              ▸
                            </span>
                          )}
                        </td>
                        <td>
                          <a href={l.url} target="_blank" rel="noreferrer">{l.title || l.id}</a>
                          {l.commune && (
                            <div className="muted" style={{ fontSize: "0.78rem" }}>{l.commune}</div>
                          )}
                        </td>
                        <td className="num">
                          {eur(l.price)}
                          {l.price_delta != null && (
                            <span className={`delta-badge ${l.price_delta < 0 ? "down" : "up"}`}>
                              {l.price_delta < 0 ? "↓" : "↑"} {eur(Math.abs(l.price_delta))}
                            </span>
                          )}
                        </td>
                        <td className="num">{l.surface}</td>
                        <td>{l.cpe ? <span className="badge">{l.cpe}</span> : "—"}</td>
                        <td className="num">{l.marginPct != null ? `${l.marginPct}%` : "—"}</td>
                        <td>
                          <span style={{ fontSize: "0.82rem" }} className={stale ? "muted" : ""}>
                            {age === 0 ? "Aujourd'hui" : age === 1 ? "Hier" : `Il y a ${age}j`}
                          </span>
                          {stale && (
                            <span className="badge" style={{ marginLeft: 8, fontSize: "0.68rem" }}>inactif ?</span>
                          )}
                        </td>
                        <td style={{ textAlign: "center" }}>
                          <button className="star-btn tracked" onClick={() => untrack(l.id)} title="Retirer des suivis">★</button>
                        </td>
                      </tr>
                      {isOpen && hasScore && (
                        <tr>
                          <td colSpan={8} style={{ background: "var(--paper-2)", padding: "12px 16px" }}>
                            <div className="grid cols-2" style={{ gap: "2px 32px" }}>
                              <div>
                                <DetailRow label="Prix affiché" value={eur(l.price)} />
                                <DetailRow
                                  label="Revente estimée"
                                  value={eur(l.resaleValue!)}
                                  hint={l.resalePerM2 != null ? `${new Intl.NumberFormat("fr-FR").format(l.resalePerM2)} €/m² ${l.priceIsDefault ? "(défaut)" : "(zone)"}` : undefined}
                                />
                                <DetailRow label="Travaux TTC" value={eur(l.worksCost!)} />
                                <DetailRow label="Frais acquisition" value={eur(l.acquisitionCost!)} />
                                <DetailRow label="Frais revente" value={eur(l.resaleCost!)} />
                              </div>
                              <div>
                                <DetailRow label="Capital investi" value={eur(l.totalInvested!)} />
                                <DetailRow label="Bénéfice brut" value={eur(l.netProfit!)} />
                                <DetailRow label="Marge brute" value={`${l.marginPct} %`} />
                                <DetailRow label="Prix d'achat max (cible)" value={eur(l.maxBuyPrice!)} />
                              </div>
                            </div>

                            {/* S6 Phase 1 — historique de prix */}
                            <div style={{ marginTop: 16 }}>
                              <div className="muted" style={{ fontSize: "0.78rem", marginBottom: 8, fontWeight: 600 }}>
                                Historique de prix
                              </div>
                              {history.length < 2 ? (
                                <p className="muted" style={{ fontSize: "0.8rem", margin: 0, fontStyle: "italic" }}>
                                  Une seule observation pour l'instant — l'évolution apparaîtra dès qu'un prix change.
                                </p>
                              ) : (
                                <>
                                  <Sparkline points={history.map((h) => h.price)} />
                                  <div style={{ marginTop: 8, maxWidth: 360 }}>
                                    {[...history].reverse().map((h, i, arr) => {
                                      const older = arr[i + 1];
                                      const d = older ? h.price - older.price : null;
                                      return (
                                        <div key={h.seen_at + i} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", padding: "3px 0" }}>
                                          <span className="muted">{new Date(h.seen_at).toLocaleDateString("fr-FR")}</span>
                                          <span className="mono">
                                            {eur(h.price)}
                                            {d != null && d !== 0 && (
                                              <span style={{ marginLeft: 6, color: d < 0 ? "var(--green)" : "var(--ink-soft)" }}>
                                                {d < 0 ? "↓" : "↑"} {eur(Math.abs(d))}
                                              </span>
                                            )}
                                          </span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
