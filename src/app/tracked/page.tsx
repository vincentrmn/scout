"use client";
import { useEffect, useState } from "react";

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
};

const eur = (n: number) =>
  new Intl.NumberFormat("fr-FR").format(Math.round(n)) + " €";

const daysSince = (iso: string) =>
  Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);

export default function TrackedPage() {
  const [listings, setListings] = useState<TrackedListing[] | null>(null);

  const load = async () => {
    const r = await fetch("/api/listings?tracked=1").then((x) => x.json());
    setListings(Array.isArray(r) ? r : []);
  };

  useEffect(() => { load(); }, []);

  const untrack = async (id: string) => {
    // Mise a jour optimiste : retire immediatement de la liste
    setListings((prev) => (prev ? prev.filter((x) => x.id !== id) : prev));
    await fetch("/api/listings/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, tracked: false }),
    });
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

      {listings === null && <p className="empty">Chargement…</p>}

      {listings !== null && listings.length === 0 && (
        <p className="empty">
          Aucun bien suivi pour l'instant. Étoilez des biens depuis une page de résultats.
        </p>
      )}

      {listings !== null && listings.length > 0 && (
        <div className="card" style={{ padding: 0, overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Bien</th>
                <th className="num">Prix</th>
                <th className="num">m²</th>
                <th>CPE</th>
                <th>Dernière vue</th>
                <th style={{ width: 36 }}></th>
              </tr>
            </thead>
            <tbody>
              {listings.map((l) => {
                const age = daysSince(l.last_seen);
                const stale = age > 30;
                return (
                  <tr key={l.id}>
                    <td>
                      <a href={l.url} target="_blank" rel="noreferrer">
                        {l.title || l.id}
                      </a>
                      {l.commune && (
                        <div className="muted" style={{ fontSize: "0.78rem" }}>
                          {l.commune}
                        </div>
                      )}
                    </td>
                    <td className="num">
                      {eur(l.price)}
                      {l.price_delta != null && (
                        <span
                          className={`delta-badge ${l.price_delta < 0 ? "down" : "up"}`}
                        >
                          {l.price_delta < 0 ? "↓" : "↑"}{" "}
                          {eur(Math.abs(l.price_delta))}
                        </span>
                      )}
                    </td>
                    <td className="num">{l.surface}</td>
                    <td>
                      {l.cpe ? <span className="badge">{l.cpe}</span> : "—"}
                    </td>
                    <td>
                      <span
                        style={{ fontSize: "0.82rem" }}
                        className={stale ? "muted" : ""}
                      >
                        {age === 0
                          ? "Aujourd'hui"
                          : age === 1
                          ? "Hier"
                          : `Il y a ${age}j`}
                      </span>
                      {stale && (
                        <span
                          className="badge"
                          style={{ marginLeft: 8, fontSize: "0.68rem" }}
                        >
                          inactif ?
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <button
                        className="star-btn tracked"
                        onClick={() => untrack(l.id)}
                        title="Retirer des suivis"
                      >
                        ★
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
