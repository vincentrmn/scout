"use client";
import { useEffect, useState } from "react";

type Finding = {
  listing_id: string;
  run_id: number | null;
  config_name?: string;
  verdict: "GO" | "NEGOCIER";
  margin_pct: number | null;
  price: number;
  found_at: string;
  url: string;
  title?: string;
  surface?: number;
  commune?: string;
  cpe?: string;
  tracked: boolean;
};

type Payload = { items: Finding[]; total: number; page: number; pageSize: number };

const eur = (n: number) => new Intl.NumberFormat("fr-FR").format(Math.round(n)) + " €";

export default function NouveautesPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [tracked, setTracked] = useState<Set<string>>(new Set());

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

  const follow = async (id: string) => {
    if (tracked.has(id)) return;
    setTracked((prev) => new Set(prev).add(id));
    await fetch("/api/listings/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, tracked: true }),
    }).catch(() => {});
  };

  const totalPages = data ? Math.max(Math.ceil(data.total / data.pageSize), 1) : 1;

  return (
    <div className="wrap">
      <div className="topbar">
        <div className="brand">
          <span className="dot" />
          <h1>Nouveautés</h1>
        </div>
        <a className="btn ghost" href="/">← Retour</a>
      </div>

      {data === null && error === null && <p className="empty">Chargement…</p>}

      {error !== null && (
        <div className="card">
          <p className="error" style={{ margin: 0 }}>Erreur : {error}</p>
          <button className="btn ghost" onClick={() => load(page)} style={{ marginTop: 12 }}>Réessayer</button>
        </div>
      )}

      {data !== null && data.total === 0 && (
        <p className="empty">
          Aucune opportunité pour l'instant. Les biens GO / à négocier découverts par tes veilles s'afficheront ici.
        </p>
      )}

      {data !== null && data.total > 0 && (
        <>
          <p className="muted" style={{ fontSize: "0.82rem", marginBottom: 14 }}>
            {data.total} opportunité{data.total > 1 ? "s" : ""} découverte{data.total > 1 ? "s" : ""} par la veille · les plus récentes d'abord.
          </p>
          <div className="card" style={{ padding: 0, overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Bien</th>
                  <th className="num">Prix</th>
                  <th className="num">m²</th>
                  <th>CPE</th>
                  <th className="num">Marge</th>
                  <th>Verdict</th>
                  <th>Découvert</th>
                  <th style={{ width: 90 }}></th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((f) => {
                  const isTracked = tracked.has(f.listing_id);
                  return (
                    <tr key={f.listing_id}>
                      <td>
                        <a href={f.url} target="_blank" rel="noreferrer">{f.title || f.listing_id}</a>
                        <div className="muted" style={{ fontSize: "0.78rem" }}>
                          {f.commune || "—"}{f.config_name ? ` · ${f.config_name}` : ""}
                        </div>
                      </td>
                      <td className="num">{eur(f.price)}</td>
                      <td className="num">{f.surface ?? "—"}</td>
                      <td>{f.cpe ? <span className="badge">{f.cpe}</span> : "—"}</td>
                      <td className="num">{f.margin_pct != null ? `${f.margin_pct}%` : "—"}</td>
                      <td><span className={`verdict ${f.verdict}`}>{f.verdict}</span></td>
                      <td>
                        <span style={{ fontSize: "0.82rem" }} className="muted">
                          {new Date(f.found_at).toLocaleDateString("fr-FR")}
                        </span>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {isTracked ? (
                          <span className="badge" style={{ color: "var(--green-ink)" }}>★ Suivi</span>
                        ) : (
                          <button className="btn ghost" style={{ padding: "6px 12px" }} onClick={() => follow(f.listing_id)}>
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
              <button className="btn ghost" disabled={page <= 0} onClick={() => setPage((p) => Math.max(p - 1, 0))}>
                ← Précédent
              </button>
              <span className="muted" style={{ fontSize: "0.85rem" }}>
                Page {page + 1} / {totalPages}
              </span>
              <button className="btn ghost" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>
                Suivant →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
