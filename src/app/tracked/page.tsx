"use client";
import { Fragment, useEffect, useState } from "react";
import PhotoStrip from "@/components/PhotoStrip";
import AnalysisPanel from "@/components/AnalysisPanel";
import PropertyMap from "@/components/PropertyMap";
import NavMenu from "@/components/NavMenu";
import { ExcelIcon, PdfIcon } from "@/components/ExportIcons";
import TrackedFilters from "@/components/TrackedFilters";
import PlaylistEditor from "@/components/PlaylistEditor";
import { EMPTY_FILTER, matchesFilter, activeFilterCount, type TrackedFilter } from "@/lib/trackedFilter";
import { isInPlaylist, toggleKind, type Playlist, type PlaylistRules } from "@/lib/playlist";
import { exportExcel, exportPdf, type ExportBien } from "@/lib/exportTracked";
import { realAddress } from "@/lib/address";
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
  matchedConfigIds?: number[];             // S11 — recherches dont le bien matche les critères
  baselineScoring?: ScoringSnapshot;       // S9 — hypotheses de la recherche d'origine
  analysisScoring?: ScoringSnapshot | null; // S9 — essai de rentabilite persiste
  history?: Snapshot[];
  notes?: Note[];
  photos?: string[]; // S8
  lat?: number | null; // S10
  lng?: number | null;
  address?: string | null;
  loc?: "exact" | "athome" | "quartier";
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
  { key: "sold", label: "Vendu" },
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
  const [filter, setFilter] = useState<TrackedFilter>(EMPTY_FILTER);
  const [showFilters, setShowFilters] = useState(false);
  // S11 — playlists
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [configs, setConfigs] = useState<{ id: number; name: string }[]>([]);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<number | null>(null);
  const [editing, setEditing] = useState<"new" | number | null>(null);
  const [plBusy, setPlBusy] = useState(false);
  const [exporting, setExporting] = useState<null | "excel" | "pdf">(null);

  const doExport = async (kind: "excel" | "pdf", rows: ExportBien[], title: string) => {
    if (exporting) return;
    setExporting(kind);
    try {
      if (kind === "excel") await exportExcel(rows, title);
      else await exportPdf(rows, title, title);
    } catch (e) {
      console.error("[export]", e);
    } finally {
      setExporting(null);
    }
  };

  const loadPlaylists = async () => {
    const r = await fetch("/api/playlists").then((x) => x.json()).catch(() => []);
    setPlaylists(Array.isArray(r) ? r : []);
  };
  useEffect(() => {
    loadPlaylists();
    fetch("/api/configs").then((x) => x.json()).then((r) => {
      if (Array.isArray(r)) setConfigs(r.map((c: any) => ({ id: c.id, name: c.name })));
    }).catch(() => {});
  }, []);

  const savePlaylist = async (name: string, rules: PlaylistRules) => {
    setPlBusy(true);
    if (editing === "new") {
      await fetch("/api/playlists", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, rules }) }).catch(() => {});
    } else if (typeof editing === "number") {
      await fetch(`/api/playlists?id=${editing}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, rules }) }).catch(() => {});
    }
    setPlBusy(false);
    setEditing(null);
    await loadPlaylists();
  };

  const deletePlaylist = async (id: number) => {
    if (!confirm("Supprimer cette playlist ?")) return;
    await fetch(`/api/playlists?id=${id}`, { method: "DELETE" }).catch(() => {});
    if (selectedPlaylistId === id) setSelectedPlaylistId(null);
    await loadPlaylists();
  };

  const toggleMembership = async (l: TrackedListing, p: Playlist) => {
    const kind = toggleKind(l, p);
    await fetch("/api/playlists/items", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ playlistId: p.id, listingId: l.id, kind }) }).catch(() => {});
    await loadPlaylists();
  };

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
          <NavMenu links={[{ href: "/carte", label: "🗺 Carte" }, { href: "/", label: "← Retour" }]} />
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

      {listings !== null && listings.length > 0 && (() => {
        const cpeOptions = Array.from(new Set(listings.map((l) => l.cpe).filter((c): c is string => !!c))).sort();
        const communeOptions = Array.from(new Set(listings.map((l) => l.commune).filter((c): c is string => !!c))).sort();
        const selectedPlaylist = selectedPlaylistId != null ? playlists.find((p) => p.id === selectedPlaylistId) ?? null : null;
        const editingPlaylist = typeof editing === "number" ? playlists.find((p) => p.id === editing) ?? null : null;
        const baseList = selectedPlaylist ? listings.filter((l) => isInPlaylist(l, selectedPlaylist)) : listings;
        const filtered = baseList.filter((l) => matchesFilter(l, filter));
        const nActive = activeFilterCount(filter);
        const exportTitle = selectedPlaylist ? `Suivis - ${selectedPlaylist.name}` : "Suivis";
        const buildExportRows = (): ExportBien[] =>
          filtered.map((l) => {
            const eff = l.analysisScoring ?? l.baselineScoring;
            const gmaps =
              typeof l.lat === "number" && typeof l.lng === "number"
                ? `https://www.google.com/maps?q=${l.lat},${l.lng}`
                : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${realAddress(l.address) || ""} ${l.commune || ""}`.trim())}`;
            return {
              bien: l.title || l.id,
              commune: l.commune || "",
              adresse: realAddress(l.address) || "",
              statut: statusLabel(l.follow_status),
              url: l.url,
              gmaps,
              price: l.price,
              surface: l.surface ?? "",
              cpe: l.cpe || "",
              resalePerM2: l.resalePerM2,
              resaleValue: l.resaleValue,
              worksCost: l.worksCost,
              acquisitionCost: l.acquisitionCost,
              resaleCost: l.resaleCost,
              totalInvested: l.totalInvested,
              netProfit: l.netProfit,
              marginPct: l.marginPct,
              maxBuyPrice: l.maxBuyPrice,
              worksVatPct: l.worksVatPct,
              notaryPct: l.notaryPct,
              resaleAgencyPct: l.resaleAgencyPct,
              targetMarginPct: eff?.targetMarginPct ?? null,
              lat: l.lat,
              lng: l.lng,
              photos: l.photos,
            };
          });
        return (
        <>
          {/* Playlists */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            <span className="muted" style={{ fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginRight: 2 }}>Playlists</span>
            <button type="button" className={`chip ${selectedPlaylistId === null ? "on" : ""}`} onClick={() => setSelectedPlaylistId(null)}>
              Tous ({listings.length})
            </button>
            {playlists.map((p) => {
              const count = listings.filter((l) => isInPlaylist(l, p)).length;
              return (
                <button type="button" key={p.id} className={`chip ${selectedPlaylistId === p.id ? "on" : ""}`} onClick={() => setSelectedPlaylistId(p.id)}>
                  {p.name} ({count})
                </button>
              );
            })}
            <button className="btn ghost" onClick={() => setEditing("new")}>+ Nouvelle</button>
            {selectedPlaylist && (
              <>
                <button className="btn ghost" onClick={() => setEditing(selectedPlaylist.id)}>Modifier</button>
                <button className="btn ghost" onClick={() => deletePlaylist(selectedPlaylist.id)}>Supprimer</button>
              </>
            )}
          </div>

          {editing !== null && (
            <PlaylistEditor
              key={String(editing)}
              initialName={editingPlaylist?.name ?? ""}
              initialRules={editingPlaylist?.rules}
              cpeOptions={cpeOptions}
              communeOptions={communeOptions}
              configs={configs}
              busy={plBusy}
              onSave={savePlaylist}
              onCancel={() => setEditing(null)}
            />
          )}

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <button className="btn ghost" onClick={() => setShowFilters((v) => !v)}>
                {showFilters ? "Masquer les filtres" : "Filtres"}{nActive > 0 ? ` · ${nActive}` : ""}
              </button>
              <button className="btn ghost" disabled={filtered.length === 0 || exporting !== null} onClick={() => doExport("excel", buildExportRows(), exportTitle)} title="Exporter en Excel">
                <ExcelIcon /> Excel
              </button>
              <button className="btn ghost" disabled={filtered.length === 0 || exporting !== null} onClick={() => doExport("pdf", buildExportRows(), exportTitle)} title="Exporter en PDF">
                <PdfIcon /> PDF
              </button>
            </div>
            <span className="muted" style={{ fontSize: "0.82rem" }}>
              {filtered.length} / {baseList.length} bien{baseList.length > 1 ? "s" : ""}
              {nActive > 0 && (
                <button className="btn ghost" style={{ marginLeft: 10 }} onClick={() => setFilter(EMPTY_FILTER)}>
                  Réinitialiser
                </button>
              )}
            </span>
          </div>

          {exporting && (
            <div style={{ marginBottom: 14 }}>
              <div className="muted" style={{ fontSize: "0.78rem", marginBottom: 5 }}>
                Export {exporting === "pdf" ? "PDF" : "Excel"} en cours…
                {exporting === "pdf" ? " (chargement des photos et des cartes)" : ""}
              </div>
              <div className="progress-bar"><span /></div>
            </div>
          )}

          {showFilters && (
            <TrackedFilters
              filter={filter}
              onChange={setFilter}
              cpeOptions={cpeOptions}
              communeOptions={communeOptions}
              statusOptions={STATUSES}
            />
          )}

          {filtered.length === 0 ? (
            <p className="empty">Aucun bien suivi ne correspond aux filtres.</p>
          ) : (
          <div className="card" style={{ padding: 0, overflowX: "auto" }}>
            <table className="prop-table">
              <thead>
                <tr>
                  <th style={{ width: 40 }}></th>
                  <th>Bien</th>
                  <th className="num">Prix</th>
                  <th className="num">m²</th>
                  <th>CPE</th>
                  <th className="num">Marge</th>
                  <th>Statut</th>
                  <th>Activité</th>
                  <th>Dernière vue</th>
                  <th style={{ width: 36 }}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((l) => {
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
                        <td className="cell-expand" style={{ textAlign: "center" }}>
                          <button
                            className={`expand-btn ${isOpen ? "open" : ""}`}
                            aria-label={isOpen ? "Replier" : "Détail + suivi"}
                            title={isOpen ? "Replier" : "Détail + suivi"}
                            onClick={() => toggle(l.id)}
                          >
                            ▸
                          </button>
                        </td>
                        <td className="cell-main">
                          <a href={l.url} target="_blank" rel="noreferrer">{l.title || l.id}</a>
                          {l.commune && (
                            <div className="muted" style={{ fontSize: "0.78rem" }}>{l.commune}</div>
                          )}
                        </td>
                        <td className="num" data-label="Prix">
                          {eur(l.price)}
                          {l.price_delta != null && (
                            <span className={`delta-badge ${l.price_delta < 0 ? "down" : "up"}`}>
                              {l.price_delta < 0 ? "↓" : "↑"} {eur(Math.abs(l.price_delta))}
                            </span>
                          )}
                        </td>
                        <td className="num" data-label="m²">{l.surface}</td>
                        <td data-label="CPE"><span className="badge">{l.cpe || "—"}</span></td>
                        <td className="num" data-label="Marge">{l.marginPct != null ? `${l.marginPct}%` : "—"}</td>
                        <td data-label="Statut">
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
                        <td data-label="Activité">
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
                        <td data-label="Dernière vue">
                          <span style={{ fontSize: "0.82rem" }} className={stale ? "muted" : ""}>
                            {age === 0 ? "Aujourd'hui" : age === 1 ? "Hier" : `Il y a ${age}j`}
                          </span>
                          {stale && (
                            <span className="badge" style={{ marginLeft: 8, fontSize: "0.68rem" }}>inactif ?</span>
                          )}
                        </td>
                        <td className="cell-star" style={{ textAlign: "center" }}>
                          <button className="star-btn tracked" onClick={() => untrack(l.id)} title="Retirer des suivis">★</button>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="detail-row">
                          <td className="cell-detail" colSpan={10} style={{ background: "var(--paper-2)", padding: "12px 16px" }}>
                            {playlists.length > 0 && (
                              <div style={{ marginBottom: 12 }}>
                                <div className="muted" style={{ fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
                                  Playlists
                                </div>
                                <div className="chips">
                                  {playlists.map((p) => (
                                    <button
                                      key={p.id}
                                      type="button"
                                      className={`chip ${isInPlaylist(l, p) ? "on" : ""}`}
                                      title={isInPlaylist(l, p) ? "Retirer de la playlist" : "Ajouter à la playlist"}
                                      onClick={() => toggleMembership(l, p)}
                                    >
                                      {isInPlaylist(l, p) ? "✓ " : "+ "}{p.name}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
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
                                  {l.loc === "exact" && realAddress(l.address) && (
                                    <span style={{ fontWeight: 400, fontStyle: "italic", marginLeft: 6 }}>{realAddress(l.address)}</span>
                                  )}
                                </div>
                                <PropertyMap
                                  points={[{ id: l.id, lat: l.lat, lng: l.lng, title: l.title || l.id, price: l.price, marginPct: l.marginPct, url: l.url, loc: l.loc }]}
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
          )}
        </>
        );
      })()}
    </div>
  );
}
