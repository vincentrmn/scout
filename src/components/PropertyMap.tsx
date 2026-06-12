"use client";
import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";

/**
 * S10 — Carte Leaflet (OpenStreetMap), sans clé API.
 * Couches Plan / Satellite + statut de localisation par bien :
 *   - exact    : atHome donne la rue → pin VERT « Adresse exacte »
 *   - athome   : coordonnées atHome sans rue → pin ROUGE « Localisation AtHome »
 *   - quartier : pas de coords atHome, centroïde du quartier (fallback transitoire)
 *                → pin GRIS « Position approximative (quartier) »
 */

export type LocStatus = "exact" | "athome" | "quartier";

export type MapPoint = {
  id?: string;
  lat: number;
  lng: number;
  title?: string;
  price?: number;
  marginPct?: number | null;
  url?: string;
  loc?: LocStatus;
};

const LOC_STYLE: Record<LocStatus, { color: "green" | "red" | "grey"; label: string; bg: string; fg: string }> = {
  exact: { color: "green", label: "📍 Adresse exacte", bg: "#e7f7f1", fg: "#0a8f6c" },
  athome: { color: "red", label: "📍 Localisation AtHome", bg: "#fdecea", fg: "#c0392b" },
  quartier: { color: "grey", label: "≈ Position approximative (quartier)", bg: "#fff7e6", fg: "#9a6b00" },
};

const eur = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".") + " €";

// Petit décalage déterministe pour éviter que des points "quartier" (même
// centroïde) se superposent exactement.
function jitter(id: string | undefined, seedAdd: number): number {
  let h = 2166136261;
  const s = (id ?? "") + seedAdd;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (((h >>> 0) % 1000) / 1000 - 0.5) * 0.0016; // ~±90 m
}

const ESCAPE: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ESCAPE[c]);

export default function PropertyMap({ points, height = 240 }: { points: MapPoint[]; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let map: any;
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !ref.current) return;

      const mk = (color: string) =>
        L.icon({
          iconUrl: `https://cdn.jsdelivr.net/gh/pointhi/leaflet-color-markers@master/img/marker-icon-${color}.png`,
          iconRetinaUrl: `https://cdn.jsdelivr.net/gh/pointhi/leaflet-color-markers@master/img/marker-icon-2x-${color}.png`,
          shadowUrl: "https://cdn.jsdelivr.net/gh/pointhi/leaflet-color-markers@master/img/marker-shadow.png",
          iconSize: [25, 41],
          iconAnchor: [12, 41],
          popupAnchor: [1, -34],
          shadowSize: [41, 41],
        });
      const icons: Record<LocStatus, any> = {
        exact: mk("green"),
        athome: mk("red"),
        quartier: mk("grey"),
      };

      // Couches de fond commutables (Plan / Satellite), sans clé API.
      const plan = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap",
      });
      const sat = L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        { maxZoom: 19, attribution: "Tiles &copy; Esri" }
      );

      map = L.map(ref.current, { scrollWheelZoom: true, layers: [plan] });
      L.control.layers({ Plan: plan, Satellite: sat }, {}, { position: "topright" }).addTo(map);

      const valid = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
      const latlngs: [number, number][] = [];
      for (const p of valid) {
        const loc: LocStatus = p.loc ?? "athome";
        const style = LOC_STYLE[loc];
        const lat = loc === "quartier" ? p.lat + jitter(p.id, 1) : p.lat;
        const lng = loc === "quartier" ? p.lng + jitter(p.id, 2) : p.lng;
        latlngs.push([lat, lng]);
        const m = L.marker([lat, lng], { icon: icons[loc] }).addTo(map);
        const parts: string[] = [];
        if (p.title) parts.push(`<strong>${esc(p.title)}</strong>`);
        const line: string[] = [];
        if (typeof p.price === "number") line.push(eur(p.price));
        if (p.marginPct != null) line.push(`marge ${p.marginPct}%`);
        if (line.length) parts.push(line.join(" · "));
        parts.push(`<span style="color:${style.fg}">${style.label}</span>`);
        if (p.url) parts.push(`<a href="${esc(p.url)}" target="_blank" rel="noreferrer">Voir l'annonce ↗</a>`);
        if (parts.length) m.bindPopup(parts.join("<br>"));
      }

      if (latlngs.length === 1) {
        map.setView(latlngs[0], 15);
      } else if (latlngs.length > 1) {
        map.fitBounds(latlngs, { padding: [30, 30], maxZoom: 16 });
      } else {
        map.setView([49.6116, 6.1319], 12); // Luxembourg-Ville par défaut
      }
      setTimeout(() => map && map.invalidateSize(), 0);
    })();

    return () => {
      cancelled = true;
      if (map) map.remove();
    };
  }, [points]);

  // Badge de statut toujours visible (en bas à gauche : pas de chevauchement
  // avec le zoom en haut g. ni le sélecteur de couches en haut d.).
  const single = points.length === 1 ? points[0] : null;
  let badge: { text: string; bg: string; fg: string } | null = null;
  if (single) {
    const s = LOC_STYLE[single.loc ?? "athome"];
    badge = { text: s.label, bg: s.bg, fg: s.fg };
  } else if (points.length > 1) {
    const present = new Set(points.map((p) => p.loc ?? "athome"));
    const legend = (["exact", "athome", "quartier"] as LocStatus[])
      .filter((k) => present.has(k))
      .map((k) => LOC_STYLE[k].label)
      .join(" · ");
    badge = { text: legend, bg: "rgba(255,255,255,0.92)", fg: "#444" };
  }

  return (
    <div style={{ position: "relative" }}>
      <div ref={ref} style={{ height, width: "100%", borderRadius: 10, overflow: "hidden", border: "1px solid var(--line)" }} />
      {badge && (
        <div
          style={{
            position: "absolute", bottom: 10, left: 10, zIndex: 1000,
            background: badge.bg, color: badge.fg,
            fontSize: "0.74rem", fontWeight: 700,
            padding: "4px 9px", borderRadius: 999,
            boxShadow: "0 1px 4px rgba(0,0,0,0.2)", pointerEvents: "none",
          }}
        >
          {badge.text}
        </div>
      )}
    </div>
  );
}
