"use client";
import { Fragment, useEffect, useState } from "react";
import PhotoStrip from "@/components/PhotoStrip";
import PropertyMap from "@/components/PropertyMap";
import NavMenu from "@/components/NavMenu";
import { realAddress } from "@/lib/address";

type Scored = {
  id: string; url: string; title?: string; price: number; surface: number;
  commune?: string; cpe?: string;
  resalePerM2: number; priceIsDefault: boolean;
  resaleValue: number; worksCost: number; acquisitionCost: number; resaleCost: number;
  totalInvested: number; netProfit: number; marginPct: number; maxBuyPrice: number;
  verdict: "GO" | "NEGOCIER" | "PASS";
  worksVatPct?: number; notaryPct?: number; resaleAgencyPct?: number; // hypotheses affichees
  priceDelta?: number | null; // S5
  photos?: string[]; // S8
  lat?: number | null; lng?: number | null; address?: string | null; // S10
  source?: "athome" | "immotop" | "both"; altUrl?: string; // S14
};
type RunStats = {
  totalAtHome: number; pagesFetched: number; pagesPlanned: number;
  countSold: number; countNew: number; capped: boolean;
  countReceived?: number; countIncomplete?: number;
};
type Run = {
  id: number; config_name: string; status: string; count: number;
  error?: string; started_at: string; results: Scored[]; stats?: RunStats | null;
};

const eur = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".") + " €";
const plur = (n: number) => (n > 1 ? "s" : "");
// Fraction (0.17) -> "17 %". Sert a afficher les hypotheses dans le detail.
const pct = (v?: number) => (typeof v === "number" ? `${Math.round(v * 1000) / 10} %` : null);

// Affichage des verdicts (les valeurs stockées restent GO/NEGOCIER/PASS).
const VERDICT_LABEL: Record<Scored["verdict"], string> = {
  GO: "OK",
  NEGOCIER: "Négocier",
  PASS: "KO",
};

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
      // runId = ce run : sert a capturer ses hypotheses de scoring sur le bien suivi.
      body: JSON.stringify({ id, tracked: !isTracked, runId: Number(params.id) }),
    });
  };

  return (
    <div className="wrap">
      <div className="topbar">
        <a className="brand-home" href="/" title="Accueil">SCOUT</a>
        <h1 className="page-title">{run?.config_name || "Résultats"}</h1>
        <div className="topbar-nav">
          <NavMenu links={[{ href: "/tracked", label: "★ Suivis" }, { href: "/", label: "← Retour" }]} />
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
          {stats && (() => {
            // Réconciliation : on attribue CHAQUE bien manquant à un motif.
            // Résidu = exclus par n8n hors vendu/neuf (CPE hors critères, type,
            // doublons) — ces biens ne parviennent jamais à l'app, d'où le bucket.
            const sold = stats.countSold ?? 0;
            const neuf = stats.countNew ?? 0;
            const incomplete = stats.countIncomplete ?? 0;
            const residual = Math.max(
              0,
              stats.totalAtHome - sold - neuf - incomplete - run.count
            );
            const exclusions: { label: string; n: number }[] = [
              { label: "vendus (déjà sous compromis)", n: sold },
              { label: "neufs / en construction", n: neuf },
              { label: "hors critères CPE, type ou doublons", n: residual },
              { label: "données incomplètes (prix ou surface manquant)", n: incomplete },
            ].filter((e) => e.n > 0);
            const totalExcluded = stats.totalAtHome - run.count;
            return (
              <div className="card" style={{ marginBottom: 16 }}>
                <div style={{ fontSize: "0.9rem" }}>
                  <strong>{stats.totalAtHome}</strong> bien{plur(stats.totalAtHome)} trouvé{plur(stats.totalAtHome)} sur atHome ·{" "}
                  <strong>{stats.pagesFetched}</strong> page{plur(stats.pagesFetched)} scrapée{plur(stats.pagesFetched)}
                  {stats.pagesPlanned > stats.pagesFetched ? ` sur ${stats.pagesPlanned} prévues` : ""} ·{" "}
                  après filtres : <strong>{run.count}</strong> bien{plur(run.count)} analysé{plur(run.count)}.
                </div>
                {stats.capped && (
                  <div className="error" style={{ marginTop: 8 }}>
                    ⚠️ Limite atteinte (50 pages ≈ 1000 biens). Augmente <span className="mono">maxPages</span> ou affine tes filtres.
                  </div>
                )}
                {totalExcluded > 0 && (
                  <details style={{ marginTop: 10 }}>
                    <summary style={{ cursor: "pointer", fontSize: "0.82rem", color: "var(--ink-soft)" }}>
                      Pourquoi {totalExcluded} bien{plur(totalExcluded)} exclu{plur(totalExcluded)} ?
                    </summary>
                    <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: "0.82rem", color: "var(--ink-soft)", lineHeight: 1.6 }}>
                      {exclusions.map((e) => (
                        <li key={e.label}><strong>{e.n}</strong> — {e.label}</li>
                      ))}
                    </ul>
                    <p style={{ margin: "8px 0 0", fontSize: "0.75rem", color: "var(--ink-soft)" }}>
                      Vendus / neufs / hors-CPE sont écartés au scraping (atHome) ; les données incomplètes le sont à l'analyse.
                    </p>
                  </details>
                )}
              </div>
            );
          })()}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 16, flexWrap: "wrap" }}>
            <p className="muted" style={{ margin: "0 0 12px" }}>
              {run.count} bien{plur(run.count)} · lancé le {new Date(run.started_at).toLocaleString("fr-FR")}
            </p>
            {/* Légende des verdicts (seuils du moteur de scoring) */}
            <p className="muted" style={{ margin: "0 0 12px", fontSize: "0.8rem", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span><span className="verdict GO">OK</span> marge ≥ cible</span>
              <span><span className="verdict NEGOCIER">Négocier</span> ≥ moitié de la cible</span>
              <span><span className="verdict PASS">KO</span> en dessous</span>
            </p>
          </div>

          {run.count === 0 && <p className="empty">Aucun bien ne correspond aux critères.</p>}
          {run.count > 0 && (
            <div className="card" style={{ padding: 0, overflowX: "auto" }}>
              <table className="prop-table">
                <thead>
                  <tr>
                    <th style={{ width: 40 }}></th>
                    <th>Bien</th>
                    <th className="num">Prix</th>
                    <th className="num">m²</th>
                    <th>CPE</th>
                    <th className="num">Prix de revente</th>
                    <th className="num">Marge</th>
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
                          <td className="cell-expand" style={{ textAlign: "center" }}>
                            <button
                              className={`expand-btn ${isOpen ? "open" : ""}`}
                              aria-label={isOpen ? "Replier le détail" : "Voir le détail du calcul"}
                              title={isOpen ? "Replier" : "Détail du calcul"}
                              onClick={() => toggle(r.id)}
                            >
                              ▸
                            </button>
                          </td>
                          <td className="cell-main">
                            <a href={r.url} target="_blank" rel="noreferrer">{r.title || r.id}</a>
                            {r.source === "both" && r.altUrl ? (
                              <a className="src-badge" href={r.altUrl} target="_blank" rel="noreferrer" title="Présent sur les deux portails">atHome + immotop ↗</a>
                            ) : r.source === "immotop" ? (
                              <span className="src-badge" title="Source : immotop.lu">immotop</span>
                            ) : null}
                            {r.commune && <div className="muted" style={{ fontSize: "0.78rem" }}>{r.commune}</div>}
                          </td>
                          <td className="num" data-label="Prix">
                            {eur(r.price)}
                            {r.priceDelta != null && (
                              <span className={`delta-badge ${r.priceDelta < 0 ? "down" : "up"}`}>
                                {r.priceDelta < 0 ? "↓" : "↑"} {eur(Math.abs(r.priceDelta))}
                              </span>
                            )}
                          </td>
                          <td className="num" data-label="m²">{r.surface}</td>
                          <td data-label="CPE"><span className="badge">{r.cpe || "—"}</span></td>
                          <td className="num" data-label="Revente">{eur(r.resaleValue)}</td>
                          <td className="num" data-label="Marge">{r.marginPct}%</td>
                          <td data-label="Verdict"><span className={`verdict ${r.verdict}`}>{VERDICT_LABEL[r.verdict]}</span></td>
                          <td className="cell-star" style={{ textAlign: "center" }}>
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
                          <tr className="detail-row">
                            <td className="cell-detail" colSpan={9} style={{ background: "var(--paper-2)", padding: "12px 16px" }}>
                              <PhotoStrip photos={r.photos} />
                              <div className="grid cols-2" style={{ gap: "2px 32px" }}>
                                <div>
                                  <DetailRow label="Prix affiché" value={eur(r.price)} />
                                  <DetailRow
                                    label="Revente estimée"
                                    value={eur(r.resaleValue)}
                                    hint={r.resalePerM2 != null ? `${Math.round(r.resalePerM2).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")} €/m² ${r.priceIsDefault ? "(défaut)" : "(zone)"}` : undefined}
                                  />
                                  <DetailRow label={`Travaux TTC${pct(r.worksVatPct) ? ` (TVA ${pct(r.worksVatPct)})` : ""}`} value={eur(r.worksCost)} />
                                  <DetailRow label={`Frais acquisition${pct(r.notaryPct) ? ` (${pct(r.notaryPct)})` : ""}`} value={eur(r.acquisitionCost)} />
                                  <DetailRow label={`Frais revente${pct(r.resaleAgencyPct) ? ` (${pct(r.resaleAgencyPct)})` : ""}`} value={eur(r.resaleCost)} />
                                </div>
                                <div>
                                  <DetailRow label="Capital investi" value={eur(r.totalInvested)} />
                                  <DetailRow label="Bénéfice brut" value={eur(r.netProfit)} />
                                  <DetailRow label="Marge brute" value={`${r.marginPct} %`} />
                                  <DetailRow label="Prix d'achat max (cible)" value={eur(r.maxBuyPrice)} />
                                </div>
                              </div>
                              {typeof r.lat === "number" && typeof r.lng === "number" && (
                                <div style={{ marginTop: 14 }}>
                                  <div className="muted" style={{ fontSize: "0.78rem", marginBottom: 8, fontWeight: 600 }}>
                                    Localisation
                                    {realAddress(r.address) && <span style={{ fontWeight: 400, fontStyle: "italic", marginLeft: 6 }}>{realAddress(r.address)}</span>}
                                  </div>
                                  <PropertyMap
                                    points={[{ id: r.id, lat: r.lat, lng: r.lng, title: r.title || r.id, price: r.price, marginPct: r.marginPct, url: r.url, loc: realAddress(r.address) ? "exact" : "athome" }]}
                                    height={340}
                                  />
                                </div>
                              )}
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
