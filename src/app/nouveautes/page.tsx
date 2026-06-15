"use client";
import { useEffect, useState } from "react";

type Finding = {
  id: number;
  listing_id: string;
  run_id: number | null;
  config_name?: string;
  kind: "new" | "price_drop";
  verdict: "GO" | "NEGOCIER";
  margin_pct: number | null;
  price: number;
  prev_price: number | null;
  found_at: string;
  url: string;
  title?: string;
  surface?: number;
  commune?: string;
  cpe?: string;
  tracked: boolean;
};

type Payload = { items: Finding[]; total: number; page: number; pageSize: number };

const eur = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".") + " €";

// Affichage des verdicts (valeurs stockées inchangées).
const VERDICT_LABEL: Record<Finding["verdict"], string> = {
  GO: "OK",
  NEGOCIER: "Négocier",
};

const CPE_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H", "I"];
const ETATS: [string, string][] = [["a_renover", "À rénover"], ["habitable", "Habitable"], ["renove", "Rénové"]];

export default function NouveautesPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [tracked, setTracked] = useState<Set<string>>(new Set());
  // S16 — config Nouveautés (réglable).
  const [cfg, setCfg] = useState<any | null>(null);
  const [showCfg, setShowCfg] = useState(false);
  const [cfgSaved, setCfgSaved] = useState(false);

  useEffect(() => {
    fetch("/api/nouveautes-config").then((r) => r.json()).then(setCfg).catch(() => {});
  }, []);

  const saveCfg = async () => {
    if (!cfg) return;
    await fetch("/api/nouveautes-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cfg),
    }).catch(() => {});
    setCfgSaved(true);
    setTimeout(() => setCfgSaved(false), 2500);
  };
  const setF = (k: string, v: any) => setCfg((c: any) => ({ ...c, [k]: v }));
  const setScore = (k: string, v: any) => setCfg((c: any) => ({ ...c, scoring: { ...c.scoring, [k]: v } }));
  const toggleIn = (arr: string[], x: string) => (arr.includes(x) ? arr.filter((y) => y !== x) : [...arr, x]);

  const load = async (p: number) => {
    setError(null);
    try {
      const res = await fetch(`/api/findings?page=${p}&pageSize=30`);
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error ?? `HTTP ${res.status}`);
      }
      const j: Payload = await res.json();
      setData(j);
      setTracked(new Set(j.items.filter((i) => i.tracked).map((i) => i.listing_id)));
    } catch (e: any) {
      setError(e?.message ?? "Erreur inconnue");
      setData(null);
    }
  };

  useEffect(() => { load(page); }, [page]);

  const follow = async (id: string, runId: number | null) => {
    if (tracked.has(id)) return;
    setTracked((prev) => new Set(prev).add(id));
    await fetch("/api/listings/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // runId du finding : capture les hypotheses de la recherche d'origine.
      body: JSON.stringify({ id, tracked: true, runId: runId ?? undefined }),
    }).catch(() => {});
  };

  const totalPages = data ? Math.max(Math.ceil(data.total / data.pageSize), 1) : 1;

  return (
    <div className="wrap">
      <div className="topbar">
        <a className="brand-home" href="/" title="Accueil">SCOUT</a>
        <h1 className="page-title">Nouveautés</h1>
        <div className="topbar-nav">
          <a className="btn ghost" href="/">← Retour</a>
        </div>
      </div>

      {cfg && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }} onClick={() => setShowCfg((s) => !s)}>
            <strong>⚙ Régler les Nouveautés</strong>
            <span className="muted" style={{ fontSize: "0.8rem" }}>{showCfg ? "Replier ▲" : "Déplier ▼"}</span>
          </div>
          {showCfg && (
            <div style={{ marginTop: 14 }}>
              <p className="muted" style={{ fontSize: "0.82rem", marginTop: 0 }}>
                Sur tous les biens des relevés (atHome + Immotop), seuls ceux qui matchent ces critères remontent en Nouveautés.
              </p>
              <div className="row">
                <div><label>Surface min</label><input type="number" value={cfg.surfaceMin ?? ""} onChange={(e) => setF("surfaceMin", e.target.value === "" ? null : Number(e.target.value))} /></div>
                <div><label>Surface max</label><input type="number" value={cfg.surfaceMax ?? ""} onChange={(e) => setF("surfaceMax", e.target.value === "" ? null : Number(e.target.value))} /></div>
                <div><label>Prix min (€)</label><input type="number" value={cfg.priceMin ?? ""} onChange={(e) => setF("priceMin", e.target.value === "" ? null : Number(e.target.value))} /></div>
                <div><label>Prix max (€)</label><input type="number" value={cfg.priceMax ?? ""} onChange={(e) => setF("priceMax", e.target.value === "" ? null : Number(e.target.value))} /></div>
              </div>
              <div style={{ marginTop: 12 }}>
                <label>Classes CPE — vide = toutes (s'applique à atHome)</label>
                <div className="chips">{CPE_LETTERS.map((c) => <span key={c} className={`chip ${cfg.cpeClasses?.includes(c) ? "on" : ""}`} onClick={() => setF("cpeClasses", toggleIn(cfg.cpeClasses || [], c))}>{c}</span>)}</div>
              </div>
              <div style={{ marginTop: 12 }}>
                <label>État — vide = tous (s'applique à Immotop)</label>
                <div className="chips">{ETATS.map(([k, lbl]) => <span key={k} className={`chip ${cfg.conditions?.includes(k) ? "on" : ""}`} onClick={() => setF("conditions", toggleIn(cfg.conditions || [], k))}>{lbl}</span>)}</div>
              </div>
              <div style={{ marginTop: 12 }}>
                <label>Verdict retenu</label>
                <div className="chips">{[["GO", "OK"], ["NEGOCIER", "Négocier"]].map(([k, lbl]) => <span key={k} className={`chip ${cfg.verdicts?.includes(k) ? "on" : ""}`} onClick={() => setF("verdicts", toggleIn(cfg.verdicts || [], k))}>{lbl}</span>)}</div>
              </div>
              <div className="section-title" style={{ marginTop: 18 }}><h2 style={{ fontSize: "0.95rem" }}>Hypothèses de scoring</h2><span className="rule" /></div>
              <div className="row">
                <div><label>Travaux (€/m²)</label><input type="number" value={cfg.scoring?.worksEurPerM2 ?? ""} onChange={(e) => setScore("worksEurPerM2", Number(e.target.value))} /></div>
                <div><label>TVA travaux (%)</label><input type="number" value={Math.round((cfg.scoring?.worksVatPct ?? 0) * 100)} onChange={(e) => setScore("worksVatPct", Number(e.target.value) / 100)} /></div>
                <div><label>Frais acquisition (%)</label><input type="number" value={Math.round((cfg.scoring?.notaryPct ?? 0) * 100)} onChange={(e) => setScore("notaryPct", Number(e.target.value) / 100)} /></div>
                <div><label>Frais revente (%)</label><input type="number" value={Math.round((cfg.scoring?.resaleAgencyPct ?? 0) * 100)} onChange={(e) => setScore("resaleAgencyPct", Number(e.target.value) / 100)} /></div>
                <div><label>Marge cible (%)</label><input type="number" value={Math.round((cfg.scoring?.targetMarginPct ?? 0) * 100)} onChange={(e) => setScore("targetMarginPct", Number(e.target.value) / 100)} /></div>
              </div>
              <div style={{ marginTop: 16, display: "flex", gap: 12, alignItems: "center" }}>
                <button className="btn clay" onClick={saveCfg}>Enregistrer</button>
                {cfgSaved && <span className="muted" style={{ color: "var(--green-ink)" }}>✓ Enregistré</span>}
              </div>
            </div>
          )}
        </div>
      )}

      {data === null && error === null && <p className="empty">Chargement…</p>}

      {error !== null && (
        <div className="card">
          <p className="error" style={{ margin: 0 }}>Erreur : {error}</p>
          <button className="btn ghost" onClick={() => load(page)} style={{ marginTop: 12 }}>Réessayer</button>
        </div>
      )}

      {data !== null && data.total === 0 && (
        <p className="empty">
          Aucune nouveauté pour l'instant. Les nouvelles annonces et baisses de prix repérées par tes veilles s'afficheront ici, au fil des jours.
        </p>
      )}

      {data !== null && data.total > 0 && (
        <>
          <p className="muted" style={{ fontSize: "0.82rem", marginBottom: 14 }}>
            {data.total} événement{data.total > 1 ? "s" : ""} de veille · les plus récents d'abord.
          </p>
          <div className="card" style={{ padding: 0, overflowX: "auto" }}>
            <table className="prop-table">
              <thead>
                <tr>
                  <th>Bien</th>
                  <th>Signal</th>
                  <th className="num">Prix</th>
                  <th className="num">m²</th>
                  <th>CPE</th>
                  <th className="num">Marge</th>
                  <th>Verdict</th>
                  <th>Le</th>
                  <th style={{ width: 90 }}></th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((f) => {
                  const isTracked = tracked.has(f.listing_id);
                  const drop = f.kind === "price_drop" && f.prev_price != null ? f.prev_price - f.price : null;
                  return (
                    <tr key={f.id}>
                      <td className="cell-main">
                        <a href={f.url} target="_blank" rel="noreferrer">{f.title || f.listing_id}</a>
                        <div className="muted" style={{ fontSize: "0.78rem" }}>
                          {f.commune || "—"}{f.config_name ? ` · ${f.config_name}` : ""}
                        </div>
                      </td>
                      <td data-label="Signal">
                        <span
                          style={{
                            display: "inline-block",
                            fontSize: "0.72rem",
                            fontWeight: 700,
                            padding: "3px 9px",
                            borderRadius: 999,
                            background: "var(--green-soft)",
                            color: "var(--green-ink)",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {f.kind === "new"
                            ? "✨ Nouveau"
                            : `↓ ${drop != null ? eur(drop) : "baisse"}`}
                        </span>
                      </td>
                      <td className="num" data-label="Prix">{eur(f.price)}</td>
                      <td className="num" data-label="m²">{f.surface ?? "—"}</td>
                      <td data-label="CPE">{f.cpe ? <span className="badge">{f.cpe}</span> : "—"}</td>
                      <td className="num" data-label="Marge">{f.margin_pct != null ? `${f.margin_pct}%` : "—"}</td>
                      <td data-label="Verdict"><span className={`verdict ${f.verdict}`}>{VERDICT_LABEL[f.verdict] ?? f.verdict}</span></td>
                      <td data-label="Le">
                        <span style={{ fontSize: "0.82rem" }} className="muted">
                          {new Date(f.found_at).toLocaleDateString("fr-FR")}
                        </span>
                      </td>
                      <td className="cell-action" style={{ textAlign: "right" }}>
                        {isTracked ? (
                          <span className="badge" style={{ color: "var(--green-ink)" }}>★ Suivi</span>
                        ) : (
                          <button className="btn ghost" onClick={() => follow(f.listing_id, f.run_id)}>
                            ☆ Suivre
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16, marginTop: 18 }}>
              <button className="btn ghost" disabled={page <= 0} onClick={() => setPage((p) => Math.max(p - 1, 0))}>← Précédent</button>
              <span className="muted" style={{ fontSize: "0.85rem" }}>Page {page + 1} / {totalPages}</span>
              <button className="btn ghost" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>Suivant →</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
