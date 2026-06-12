"use client";
import { useEffect, useState } from "react";
import PropertyMap, { type MapPoint } from "@/components/PropertyMap";
import NavMenu from "@/components/NavMenu";

type TrackedListing = {
  id: string;
  url: string;
  title?: string;
  price: number;
  marginPct?: number | null;
  commune?: string;
  lat?: number | null;
  lng?: number | null;
  loc?: "exact" | "athome" | "quartier";
};

export default function CartePage() {
  const [listings, setListings] = useState<TrackedListing[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/listings?tracked=1");
        if (!res.ok) {
          const b = await res.json().catch(() => ({}));
          throw new Error(b.error ?? `HTTP ${res.status}`);
        }
        const r = await res.json();
        setListings(Array.isArray(r) ? r : []);
      } catch (e: any) {
        setError(e?.message ?? "Erreur inconnue");
      }
    })();
  }, []);

  const points: MapPoint[] = (listings ?? [])
    .filter((l) => typeof l.lat === "number" && typeof l.lng === "number")
    .map((l) => ({
      id: l.id,
      lat: l.lat as number,
      lng: l.lng as number,
      title: l.title || l.id,
      price: l.price,
      marginPct: l.marginPct,
      url: l.url,
      loc: l.loc,
    }));

  return (
    <div className="wrap">
      <div className="topbar">
        <a className="brand-home" href="/" title="Accueil">SCOUT</a>
        <h1 className="page-title">Carte des suivis</h1>
        <div className="topbar-nav">
          <NavMenu links={[{ href: "/tracked", label: "★ Suivis" }, { href: "/", label: "← Retour" }]} />
        </div>
      </div>

      {error !== null && (
        <div className="card"><p className="error" style={{ margin: 0 }}>Erreur : {error}</p></div>
      )}

      {listings === null && error === null && <p className="empty">Chargement…</p>}

      {listings !== null && points.length === 0 && (
        <p className="empty">Aucun bien suivi à afficher sur la carte.</p>
      )}

      {points.length > 0 && (
        <>
          <p className="muted" style={{ fontSize: "0.82rem", marginBottom: 14 }}>
            {points.length} bien{points.length > 1 ? "s" : ""} suivi{points.length > 1 ? "s" : ""} · clic sur un repère pour le détail.
          </p>
          <div className="card" style={{ padding: 8 }}>
            <PropertyMap points={points} height={560} />
          </div>
        </>
      )}
    </div>
  );
}
