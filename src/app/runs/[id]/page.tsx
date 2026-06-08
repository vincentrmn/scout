"use client";
import { Fragment, useEffect, useState } from "react";

type Scored = {
  id: string; url: string; title?: string; price: number; surface: number;
  commune?: string; cpe?: string;
  resalePerM2: number; priceIsDefault: boolean;
  resaleValue: number; worksCost: number; acquisitionCost: number; resaleCost: number;
  totalInvested: number; netProfit: number; marginPct: number; maxBuyPrice: number;
  verdict: "GO" | "NEGOCIER" | "PASS";
  priceDelta?: number | null; // S5
};
type RunStats = {
  totalAtHome: number; pagesFetched: number; pagesPlanned: number;
  countSold: number; countNew: number; capped: boolean;
};
type Run = {
  id: number; config_name: string; status: string; count: number;
  error?: string; started_at: string; results: Scored[]; stats?: RunStats | null;
};

const eur = (n: number) => new Intl.NumberFormat("fr-FR").format(Math.round(n)) + " €";
const plur = (n: number) => (n > 1 ? "s" : "");

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

export default function RunPage({ params }: { params: { id: string } }) {
  const [run, setRun] = useState<Run | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [tracked, setTracked] = useState<Set<string>>(new Set());

  // Polling du run
  useEffect(() => {
    let stop = false;
    async function tick() {
      const r = await fetch(`/api/runs?id=${params.id}`).then((x) => x.json());
      if (stop) return;
      setRun(r);
      if (r.status === "running") setTimeout(tick, 2500);
    }
    tick();
    return () => { stop = true; };
  }, [params.id]);

  // S5 — Charge les ids deja suivis au montage
  useEffect(() => {
    fetch("/api/listings?tracked=1")
      .then((r) => r.json())
      .then((rows: { id: string }[]) => {
        if (Array.isArray(rows)) setTracked(new Set(rows.map((r) => r.id)));
      })
      .catch(() => {});
  }, []);

  const stats = run?.stats;
  const toggle = (id: string) => setOpen((p) => ({ ...p, [id]: !p[id] }));

  // S5 — Bascule le suivi d'un bien (optimiste)
  const toggleTrack = async (id: string) => {
    const isTracked = tracked.has(id);
    setTracked((prev) => {
      const next = new Set(prev);
      isTracked ? next.delete(id) : next.add(id);
      return next;
    });
    await fetch("/api/listings/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, tracked: !isTracked }),
    });
  };

  return (
    <div className="wrap">
      <div className="topbar">
        <div className="brand">
          <span className="dot" />
          <h1>{run?.config_name || "Résultats"}</h1>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <a className="btn ghost" href="/tracked">★ Suivis</a>
          <a className="btn ghost" href="/">← Retour</a>
        </div>
      </div>

      {!run && <p className="empty">Chargement…</p>}

      {run?.status === "running" && (
        <div className="card"><p style={{ margin: 0 }}>⏳ Scraping en cours… (rafraîchissement auto)</p></div>
      )}
      {run?.status === "error" && (
        <div className="card"><p className="error" style={{ margin: 0 }}>Erreur : {run.error}</p></div>
      )}

      {run?.status === "done" && (
        <>
          {stats && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div style={{ fontSize: "0.9rem" }}>
                <strong>{stats.totalAtHome}</strong> bien{plur(stats.totalAtHome)} trouvé{plur(stats.totalAtHome)} ·{" "}
                <strong>{stats.pagesFetched}</strong> page{plur(stats.pagesFetched)} scrapée{plur(stats.pagesFetched)}
                {stats.pagesPlanned > stats.pagesFetched ? ` sur ${stats.pagesPlanned} prévues` : ""} ·{" "}
                après filtres : <strong>{run.count}</strong> bien{plur(run.count)} analysé{plur(run.count)}.
              </div>
              {stats.capped && (
                <div className="error" style={{ marginTop: 8 }}>
                  ⚠️ Limite atteinte (50 pages ≈ 1000 biens). Augmente <span className="mono">maxPages</span> ou affine tes filtres.
                </div>
              )}
              {(stats.countSold > 0 || stats.countNew > 0) && (
                <div className="muted" style={{ fontSize: "0.78rem", marginTop: 8 }}>
                  Exclus : {stats.countSold} vendu{plur(stats.countSold)}, {stats.countNew} neuf{plur(stats.countNew)}.
                </div>
              )}
            </div>
          )}

          <p className="muted">
            {run.count} bien{plur(run.count)} · lancé le {new Date(run.started_at).toLocaleString("fr-FR")}
          </p>
          {run.count === 0 && <p className="empty">Aucun bien ne correspond aux critères.</p>}
          {run.count > 0 && (
            <div className="card" style={{ padding: 0, overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 28 }}></th>
                    <th>Bien</th>
                    <th className="num">Prix</th>
                    <th className="num">m²</th>
                    <th>CPE</th>
                    <th className="num">Revente est.</th>
                    <th className="num">Marge</th>
                    <th className="num">Achat max</th>
                    <th>Verdict</th>
                    <th style={{ width: 36 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {run.results.map((r) => {
                    const isOpen = !!open[r.id];
                    const isTracked = tracked.has(r.id);
                    return (
                      <Fragment key={r.id}>
                        <tr>
                          <td style={{ textAlign: "center" }}>
                            <span
                              role="button"
                              aria-label={isOpen ? "Replier" : "Détail"}
                              onClick={() => toggle(r.id)}
                              style={{ cursor: "pointer", userSelect: "none", color: "var(--ink-soft)", display: "inline-block", transform: isOpen ? "rotate(90deg)" : "none", transition: "transform 0.12s ease" }}
                            >
                              ▸
                            </span>
                          </td>
                          <td>
                            <a href={r.url} target="_blank" rel="noreferrer">{r.title || r.id}</a>
                            {r.commune && <div className="muted" style={{ fontSize: "0.78rem" }}>{r.commune}</div>}
                          </td>
                          <td className="num">
                            {eur(r.price)}
                            {r.priceDelta != null && (
                              <span className={`delta-badge ${r.priceDelta < 0 ? "down" : "up"}`}>
                                {r.priceDelta < 0 ? "↓" : "↑"} {eur(Math.abs(r.priceDelta))}
                              </span>
                            )}
                          </td>
                          <td className="num">{r.surface}</td>
                          <td><span className="badge">{r.cpe || "—"}</span></td>
                          <td className="num">{eur(r.resaleValue)}</td>
                          <td className="num">{r.marginPct}%</td>
                          <td className="num">{eur(r.maxBuyPrice)}</td>
                          <td><span className={`verdict ${r.verdict}`}>{r.verdict}</span></td>
                          <td style={{ textAlign: "center" }}>
                            <button
                              className={`star-btn ${isTracked ? "tracked" : ""}`}
                              onClick={() => toggleTrack(r.id)}
                              title={isTracked ? "Retirer des suivis" : "Suivre ce bien"}
                            >
                              {isTracked ? "★" : "☆"}
                            </button>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr>
                            <td colSpan={10} style={{ background: "var(--paper-2)", padding: "12px 16px" }}>
                              <div className="grid cols-2" style={{ gap: "2px 32px" }}>
                                <div>
                                  <DetailRow label="Prix affiché" value={eur(r.price)} />
                                  <DetailRow
                                    label="Revente estimée"
                                    value={eur(r.resaleValue)}
                                    hint={r.resalePerM2 != null ? `${new Intl.NumberFormat("fr-FR").format(r.resalePerM2)} €/m² ${r.priceIsDefault ? "(défaut)" : "(zone)"}` : undefined}
                                  />
                                  <DetailRow label="Travaux TTC" value={eur(r.worksCost)} />
                                  <DetailRow label="Frais acquisition" value={eur(r.acquisitionCost)} />
                                  <DetailRow label="Frais revente" value={eur(r.resaleCost)} />
                                </div>
                                <div>
                                  <DetailRow label="Capital investi" value={eur(r.totalInvested)} />
                                  <DetailRow label="Bénéfice brut" value={eur(r.netProfit)} />
                                  <DetailRow label="Marge brute" value={`${r.marginPct} %`} />
                                  <DetailRow label="Prix d'achat max (cible)" value={eur(r.maxBuyPrice)} />
                                </div>
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
      )}
    </div>
  );
}
