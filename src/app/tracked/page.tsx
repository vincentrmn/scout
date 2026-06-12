"use client";
import { Fragment, useEffect, useState } from "react";
import PhotoStrip from "@/components/PhotoStrip";
import AnalysisPanel from "@/components/AnalysisPanel";
import PropertyMap from "@/components/PropertyMap";
import type { ScoringSnapshot } from "@/lib/scoring";

type Snapshot = { price: number; seen_at: string };
type Note = { id: number; author: string; kind: string; body: string; created_at: string };

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
  follow_status?: string;
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
  worksVatPct?: number;
  notaryPct?: number;
  resaleAgencyPct?: number;
  baselineScoring?: ScoringSnapshot;       // S9 — hypotheses de la recherche d'origine
  analysisScoring?: ScoringSnapshot | null; // S9 — essai de rentabilite persiste
  history?: Snapshot[];
  notes?: Note[];
  photos?: string[]; // S8
  lat?: number | null; // S10
  lng?: number | null;
  address?: string | null;
  coordsApprox?: boolean;
};

const eur = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".") + " €";

const daysSince = (iso: string) =>
  Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);

const PEOPLE = ["Vincent", "Jamie"];

const STATUSES: { key: string; label: string }[] = [
  { key: "to_contact", label: "À contacter" },
  { key: "contacted", label: "Contacté" },
  { key: "visit", label: "Visite prévue" },
  { key: "offer", label: "Offre faite" },
  { key: "won", label: "Gagné" },
  { key: "lost", label: "Abandonné" },
];
const statusLabel = (key?: string) =>
  STATUSES.find((s) => s.key === key)?.label ?? "À contacter";

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export default function TrackedPage() {
  const [listings, setListings] = useState<TrackedListing[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [me, setMe] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  // Identite legere : memorisee sur l'appareil.
  useEffect(() => {
    const saved = typeof window !== "undefined" ? window.localStorage.getItem("scout_me") : null;
    if (saved && PEOPLE.includes(saved)) setMe(saved);
  }, []);

  const chooseMe = (p: string) => {
    setMe(p);
    window.localStorage.setItem("scout_me", p);
  };

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
      // Marque la visite (badge "activite non vue" du dashboard)
      const saved = window.localStorage.getItem("scout_me");
      if (saved) window.localStorage.setItem(`scout_seen_${saved}`, new Date().toISOString());
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

  const changeStatus = async (id: string, status: string) => {
    if (!me) return;
    // Optimiste : statut + entree de journal locale
    setListings((prev) =>
      prev
        ? prev.map((l) =>
            l.id === id
              ? {
                  ...l,
                  follow_status: status,
                  notes: [
                    ...(l.notes ?? []),
                    { id: Date.now(), author: me, kind: "status", body: status, created_at: new Date().toISOString() },
                  ],
                }
              : l
          )
        : prev
    );
    await fetch("/api/listings/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status, author: me }),
    }).catch(() => {});
  };

  const addNote = async (id: string) => {
    const text = (drafts[id] ?? "").trim();
    if (!text || !me) return;
    setDrafts((p) => ({ ...p, [id]: "" }));
    // Optimiste
    setListings((prev) =>
      prev
        ? prev.map((l) =>
            l.id === id
              ? {
                  ...l,
                  notes: [
                    ...(l.notes ?? []),
                    { id: Date.now(), author: me, kind: "note", body: text, created_at: new Date().toISOString() },
                  ],
                }
              : l
          )
        : prev
    );
    await fetch("/api/listings/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ listing_id: id, author: me, body: text }),
    }).catch(() => {});
  };

  return (
    <div className="wrap">
      <div className="topbar">
        <a className="brand-home" href="/" title="Accueil">SCOUT</a>
        <h1 className="page-title">Suivis</h1>
        <div className="topbar-nav">
          {me && (
            <select
              value={me}
              onChange={(e) => chooseMe(e.target.value)}
              title="Qui utilise l'app sur cet appareil"
              style={{ width: "auto", padding: "8px 10px" }}
            >
              {PEOPLE.map((p) => <option key={p} value={p}>👤 {p}</option>)}
            </select>
          )}
          <a className="btn ghost" href="/carte">🗺 Carte</a>
          <a className="btn ghost" href="/">← Retour</a>
        </div>
      </div>

      {/* Choix d'identite au premier passage */}
      {!me && (
        <div className="card" style={{ marginBottom: 18 }}>
          <p style={{ margin: "0 0 12px" }}>
            <strong>Qui es-tu ?</strong> Ton nom signera tes remarques et changements de statut (mémorisé sur cet appareil).
          </p>
          <div className="row">
            {PEOPLE.map((p) => (
              <button key={p} className="btn" onClick={() => chooseMe(p)} style={{ flex: "0 0 auto" }}>
                👤 {p}
              </button>
            ))}
          </div>
        </div>
      )}

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
                  <th style={{ width: 40 }}></th>
                  <th>Bien</th>
                  <th className="num">Prix</th>
                  <th className="num">m²</th>
                  <th className="num">Marge</th>
                  <th>Statut</th>
                  <th>Activité</th>
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
                  const notes = l.notes ?? [];
                  const realNotes = notes.filter((n) => n.kind === "note");
                  const lastNote = realNotes.length ? realNotes[realNotes.length - 1] : null;
                  return (
                    <Fragment key={l.id}>
                      <tr>
                        <td style={{ textAlign: "center" }}>
                          <button
                            className={`expand-btn ${isOpen ? "open" : ""}`}
                            aria-label={isOpen ? "Replier" : "Détail + suivi"}
                            title={isOpen ? "Replier" : "Détail + suivi"}
                            onClick={() => toggle(l.id)}
                          >
                            ▸
                          </button>
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
                        <td className="num">{l.marginPct != null ? `${l.marginPct}%` : "—"}</td>
                        <td>
                          <select
                            value={l.follow_status ?? "to_contact"}
                            onChange={(e) => changeStatus(l.id, e.target.value)}
                            disabled={!me}
                            title={me ? "Changer le statut" : "Choisis d'abord qui tu es"}
                            style={{ width: "auto", padding: "6px 8px", fontSize: "0.82rem" }}
                          >
                            {STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                          </select>
                        </td>
                        <td>
                          {realNotes.length > 0 ? (
                            <div style={{ maxWidth: 180 }}>
                              <span className="badge">💬 {realNotes.length}</span>
                              {lastNote && (
                                <div className="muted" style={{ fontSize: "0.74rem", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                  {lastNote.author} : {lastNote.body}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="muted" style={{ fontSize: "0.78rem" }}>—</span>
                          )}
                        </td>
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
                      {isOpen && (
                        <tr>
                          <td colSpan={9} style={{ background: "var(--paper-2)", padding: "12px 16px" }}>
                            <PhotoStrip photos={l.photos} />
                            {hasScore && l.baselineScoring && (
                              <AnalysisPanel
                                listing={{ id: l.id, url: l.url, price: l.price, surface: l.surface, commune: l.commune, cpe: l.cpe }}
                                baseline={l.baselineScoring}
                                analysis={l.analysisScoring ?? null}
                                priceIsDefault={!!l.priceIsDefault}
                                onSaved={load}
                              />
                            )}

                            {/* S10 — Localisation sur carte */}
                            {typeof l.lat === "number" && typeof l.lng === "number" && (
                              <div style={{ marginTop: 16 }}>
                                <div className="muted" style={{ fontSize: "0.78rem", marginBottom: 8, fontWeight: 600 }}>
                                  Localisation
                                  {l.address && !l.coordsApprox && (
                                    <span style={{ fontWeight: 400, fontStyle: "italic", marginLeft: 6 }}>{l.address}</span>
                                  )}
                                </div>
                                <PropertyMap
                                  points={[{ id: l.id, lat: l.lat, lng: l.lng, title: l.title || l.id, price: l.price, marginPct: l.marginPct, url: l.url, approx: l.coordsApprox }]}
                                  height={340}
                                />
                              </div>
                            )}

                            {/* Historique de prix */}
                            <div style={{ marginTop: 16 }}>
                              <div className="muted" style={{ fontSize: "0.78rem", marginBottom: 8, fontWeight: 600 }}>
                                Historique de prix
                              </div>
                              {history.length < 2 ? (
                                <p className="muted" style={{ fontSize: "0.8rem", margin: 0, fontStyle: "italic" }}>
                                  Une seule observation pour l'instant — l'évolution apparaîtra dès qu'un prix change.
                                </p>
                              ) : (
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
                              )}
                            </div>

                            {/* S7 — Suivi collaboratif : fil de remarques + journal */}
                            <div style={{ marginTop: 18 }}>
                              <div className="muted" style={{ fontSize: "0.78rem", marginBottom: 8, fontWeight: 600 }}>
                                Suivi
                              </div>
                              {notes.length === 0 && (
                                <p className="muted" style={{ fontSize: "0.8rem", margin: "0 0 10px", fontStyle: "italic" }}>
                                  Aucune activité pour l'instant.
                                </p>
                              )}
                              {notes.length > 0 && (
                                <div style={{ maxWidth: 560, marginBottom: 10 }}>
                                  {notes.map((n) =>
                                    n.kind === "status" ? (
                                      <div key={n.id} className="muted" style={{ fontSize: "0.78rem", fontStyle: "italic", padding: "4px 0" }}>
                                        {n.author} a passé le bien en « {statusLabel(n.body)} » · {fmtDateTime(n.created_at)}
                                      </div>
                                    ) : (
                                      <div key={n.id} style={{ padding: "7px 0", borderBottom: "1px solid var(--line)" }}>
                                        <div style={{ fontSize: "0.76rem", fontWeight: 700 }}>
                                          {n.author} <span className="muted" style={{ fontWeight: 400 }}>· {fmtDateTime(n.created_at)}</span>
                                        </div>
                                        <div style={{ fontSize: "0.86rem", whiteSpace: "pre-wrap" }}>{n.body}</div>
                                      </div>
                                    )
                                  )}
                                </div>
                              )}
                              {me ? (
                                <div style={{ display: "flex", gap: 8, maxWidth: 560 }}>
                                  <input
                                    type="text"
                                    placeholder={`Remarque (signée ${me})…`}
                                    value={drafts[l.id] ?? ""}
                                    onChange={(e) => setDrafts((p) => ({ ...p, [l.id]: e.target.value }))}
                                    onKeyDown={(e) => e.key === "Enter" && addNote(l.id)}
                                  />
                                  <button className="btn green" onClick={() => addNote(l.id)} style={{ flexShrink: 0 }}>
                                    Ajouter
                                  </button>
                                </div>
                              ) : (
                                <p className="muted" style={{ fontSize: "0.8rem", fontStyle: "italic", margin: 0 }}>
                                  Choisis qui tu es (en haut) pour ajouter une remarque.
                                </p>
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
