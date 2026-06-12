"use client";
import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";

/**
 * S10 — Carte Leaflet (OpenStreetMap), sans clé API.
 * Affiche un ou plusieurs biens. Centrée/zoomée automatiquement sur les points.
 */

export type MapPoint = {
  id?: string;
  lat: number;
  lng: number;
  title?: string;
  price?: number;
  marginPct?: number | null;
  url?: string;
  approx?: boolean; // coordonnées = centroïde de quartier (pas précises)
};

const eur = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".") + " €";

// Petit décalage déterministe pour éviter que des points approximatifs (même
// centroïde de quartier) se superposent exactement.
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

      const icon = L.icon({
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41],
      });

      map = L.map(ref.current, { scrollWheelZoom: false });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap',
      }).addTo(map);

      const valid = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
      const latlngs: [number, number][] = [];
      for (const p of valid) {
        const lat = p.approx ? p.lat + jitter(p.id, 1) : p.lat;
        const lng = p.approx ? p.lng + jitter(p.id, 2) : p.lng;
        latlngs.push([lat, lng]);
        const m = L.marker([lat, lng], { icon }).addTo(map);
        const parts: string[] = [];
        if (p.title) parts.push(`<strong>${esc(p.title)}</strong>`);
        const line: string[] = [];
        if (typeof p.price === "number") line.push(eur(p.price));
        if (p.marginPct != null) line.push(`marge ${p.marginPct}%`);
        if (line.length) parts.push(line.join(" · "));
        if (p.approx) parts.push(`<em style="color:#777">Localisation approx. (quartier)</em>`);
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

  return <div ref={ref} style={{ height, width: "100%", borderRadius: 10, overflow: "hidden", border: "1px solid var(--line)" }} />;
}
