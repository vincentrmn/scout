"use client";
import { useEffect, useState } from "react";

type Scored = {
  id: string; url: string; title?: string; price: number; surface: number;
  commune?: string; cpe?: string; resaleValue: number; totalInvested: number;
  netProfit: number; marginPct: number; maxBuyPrice: number;
  verdict: "GO" | "NEGOCIER" | "PASS";
};
type Run = {
  id: number; config_name: string; status: string; count: number;
  error?: string; started_at: string; results: Scored[];
};

const eur = (n: number) => new Intl.NumberFormat("fr-FR").format(Math.round(n)) + " €";

export default function RunPage({ params }: { params: { id: string } }) {
  const [run, setRun] = useState<Run | null>(null);

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

  return (
    <div className="wrap">
      <div className="topbar">
        <div className="brand">
          <span className="dot" />
          <h1>{run?.config_name || "Résultats"}</h1>
        </div>
        <a className="btn ghost" href="/">← Retour</a>
      </div>

      {!run && <p className="empty">Chargement…</p>}

      {run?.status === "running" && (
        <div className="card"><p style={{ margin: 0 }}>⏳ Scraping en cours via n8n… (rafraîchissement auto)</p></div>
      )}
      {run?.status === "error" && (
        <div className="card"><p className="error" style={{ margin: 0 }}>Erreur : {run.error}</p></div>
      )}

      {run?.status === "done" && (
        <>
          <p className="muted">
            {run.count} biens · lancé le {new Date(run.started_at).toLocaleString("fr-FR")}
          </p>
          {run.count === 0 && <p className="empty">Aucun bien ne correspond aux critères.</p>}
          {run.count > 0 && (
            <div className="card" style={{ padding: 0, overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>Bien</th>
                    <th className="num">Prix</th>
                    <th className="num">m²</th>
                    <th>CPE</th>
                    <th className="num">Revente est.</th>
                    <th className="num">Marge</th>
                    <th className="num">Achat max</th>
                    <th>Verdict</th>
                  </tr>
                </thead>
                <tbody>
                  {run.results.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <a href={r.url} target="_blank" rel="noreferrer">{r.title || r.id}</a>
                        {r.commune && <div className="muted" style={{ fontSize: "0.78rem" }}>{r.commune}</div>}
                      </td>
                      <td className="num">{eur(r.price)}</td>
                      <td className="num">{r.surface}</td>
                      <td><span className="badge">{r.cpe || "—"}</span></td>
                      <td className="num">{eur(r.resaleValue)}</td>
                      <td className="num">{r.marginPct}%</td>
                      <td className="num">{eur(r.maxBuyPrice)}</td>
                      <td><span className={`verdict ${r.verdict}`}>{r.verdict}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
