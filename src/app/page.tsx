"use client";
import { Fragment, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Cfg = {
  id: number;
  name: string;
  criteria: any;
  scoring?: any;
  updated_at: string;
  watch_enabled?: boolean;
};
type Run = {
  id: number;
  config_name: string;
  status: string;
  count: number;
  started_at: string;
};

const pct = (v: any) => (typeof v === "number" ? `${Math.round(v * 1000) / 10} %` : "—");
const eur = (v: any) => (typeof v === "number" ? Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".") + " €" : "—");

function summarizeZones(criteria: any): string {
  if (Array.isArray(criteria?.locCodes) && criteria.locCodes.length) {
    if (criteria.locCodes.includes("L9-luxembourg")) return "Tout Luxembourg-Ville";
    const n = criteria.locCodes.length;
    return `${n} quartier${n > 1 ? "s" : ""}`;
  }
  if (Array.isArray(criteria?.communes) && criteria.communes.length) {
    return criteria.communes.join(", ");
  }
  return "—";
}

function listZones(criteria: any): string {
  if (Array.isArray(criteria?.locCodes) && criteria.locCodes.length) {
    if (criteria.locCodes.includes("L9-luxembourg")) return "Tout Luxembourg-Ville";
    return criteria.locCodes
      .map((c: string) => c.replace(/^L10-/, "").replace(/-/g, " "))
      .join(", ");
  }
  return "—";
}

function summarizeCpe(criteria: any): string {
  const c = criteria?.cpeClasses;
  return Array.isArray(c) && c.length ? c.join("") : "toutes";
}

function typeLabel(t: any): string {
  if (t === "house") return "Maison";
  if (t === "both") return "Appartement + maison";
  return "Appartement";
}

function HypRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "5px 0", borderBottom: "1px solid var(--line)" }}>
      <span className="muted" style={{ fontSize: "0.82rem" }}>{label}</span>
      <span className="mono" style={{ fontSize: "0.85rem", textAlign: "right" }}>{value}</span>
    </div>
  );
}

export default function Dashboard() {
  const [configs, setConfigs] = useState<Cfg[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [busy, setBusy] = useState<number | null>(null);
  const [openCfg, setOpenCfg] = useState<Record<number, boolean>>({});
  const router = useRouter();

  async function load() {
    const [c, r] = await Promise.all([
      fetch("/api/configs").then((x) => x.json()),
      fetch("/api/runs").then((x) => x.json()),
    ]);
    setConfigs(Array.isArray(c) ? c : []);
    setRuns(Array.isArray(r) ? r : []);
  }
  useEffect(() => { load(); }, []);

  async function relancer(id: number) {
    setBusy(id);
    const res = await fetch("/api/trigger", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ configId: id }),
    });
    const data = await res.json();
    setBusy(null);
    if (data.runId) router.push(`/runs/${data.runId}`);
  }

  async function supprimer(id: number) {
    if (!confirm("Supprimer cette config ?")) return;
    await fetch(`/api/configs/${id}`, { method: "DELETE" });
    load();
  }

  async function toggleWatch(id: number, current: boolean) {
    setConfigs((prev) =>
      prev.map((c) => (c.id === id ? { ...c, watch_enabled: !current } : c))
    );
    await fetch("/api/configs/watch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, watch_enabled: !current }),
    }).catch(() => {});
  }

  const toggleOpen = (id: number) => setOpenCfg((p) => ({ ...p, [id]: !p[id] }));

  return (
    <div className="wrap">
      <div className="topbar">
        <div className="brand">
          <a className="brand-home" href="/" title="Accueil">SCOUT</a>
        </div>
        <div className="row" style={{ flex: "0 0 auto", alignItems: "center" }}>
          <a className="btn ghost" href="/nouveautes">✨ Nouveautés</a>
          <a className="btn ghost" href="/tracked">★ Suivis</a>
          <a className="btn ghost" href="/settings">⚙ Prix de revente</a>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div className="section-title" style={{ flex: 1, margin: 0 }}>
          <h2>Recherches sauvegardées</h2>
          <span className="rule" />
        </div>
        <button className="btn clay" onClick={() => router.push("/search/new")}>
          + Nouvelle recherche
        </button>
      </div>

      <div style={{ marginTop: 16 }}>
        {configs.length === 0 && <p className="empty">Aucune config. Crée ta première recherche.</p>}
        {configs.map((c) => {
          const isOpen = !!openCfg[c.id];
          const s = c.scoring || {};
          const cr = c.criteria || {};
          return (
            <Fragment key={c.id}>
              <div className="list-item" style={isOpen ? { marginBottom: 0, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 } : undefined}>
                <div>
                  <strong>{c.name}</strong>
                  <div className="muted" style={{ fontSize: "0.85rem", marginTop: 2 }}>
                    {typeLabel(cr.propertyType)} · ≤ {cr.surfaceMax ?? "—"} m² ·{" "}
                    CPE {summarizeCpe(cr)}
                    {cr.includeNew ? " · neuf inclus" : ""} · {summarizeZones(cr)}
                  </div>
                </div>
                <div className="row" style={{ flex: "0 0 auto", alignItems: "center" }}>
                  <label
                    title="Veille : scan automatique chaque matin à 7h"
                    style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer", userSelect: "none", marginRight: 4 }}
                  >
                    <span style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--ink-soft)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                      Veille
                    </span>
                    <span className="toggle-switch">
                      <input
                        type="checkbox"
                        checked={!!c.watch_enabled}
                        onChange={() => toggleWatch(c.id, !!c.watch_enabled)}
                      />
                      <span className="toggle-switch__slider" />
                    </span>
                  </label>
                  <button className="btn ghost" onClick={() => toggleOpen(c.id)}>
                    {isOpen ? "Masquer" : "Voir"}
                  </button>
                  <button className="btn" onClick={() => relancer(c.id)} disabled={busy === c.id}>
                    {busy === c.id ? "..." : "Relancer"}
                  </button>
                  <button className="btn ghost" onClick={() => supprimer(c.id)}>✕</button>
                </div>
              </div>

              {isOpen && (
                <div
                  style={{
                    border: "1px solid var(--line)",
                    borderTop: "none",
                    borderRadius: "0 0 12px 12px",
                    background: "var(--paper-2)",
                    padding: "14px 16px",
                    marginBottom: 10,
                  }}
                >
                  <div className="grid cols-2" style={{ gap: "2px 32px" }}>
                    <div>
                      <div className="muted" style={{ fontSize: "0.74rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
                        Critères de recherche
                      </div>
                      <HypRow label="Type de bien" value={typeLabel(cr.propertyType)} />
                      <HypRow label="Zones" value={listZones(cr)} />
                      <HypRow label="Surface" value={`${cr.surfaceMin ?? "—"} → ${cr.surfaceMax ?? "—"} m²`} />
                      <HypRow label="Prix" value={`${cr.priceMin != null ? eur(cr.priceMin) : "—"} → ${cr.priceMax != null ? eur(cr.priceMax) : "—"}`} />
                      <HypRow label="CPE" value={summarizeCpe(cr)} />
                      <HypRow label="Programmes neufs" value={cr.includeNew ? "Inclus" : "Exclus"} />
                    </div>
                    <div>
                      <div className="muted" style={{ fontSize: "0.74rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
                        Hypothèses de scoring
                      </div>
                      <HypRow label="Travaux" value={s.worksEurPerM2 != null ? `${Math.round(s.worksEurPerM2).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")} €/m²` : "—"} />
                      <HypRow label="TVA travaux" value={pct(s.worksVatPct)} />
                      <HypRow label="Frais acquisition" value={pct(s.notaryPct)} />
                      <HypRow label="Frais revente" value={pct(s.resaleAgencyPct)} />
                      <HypRow label="Marge brute cible" value={pct(s.targetMarginPct)} />
                    </div>
                  </div>
                  <p className="muted" style={{ fontSize: "0.78rem", margin: "10px 0 0", fontStyle: "italic" }}>
                    Le prix de revente au m² vient de la calibration par quartier (Prix de revente).
                  </p>
                </div>
              )}
            </Fragment>
          );
        })}
      </div>

      <div className="section-title">
        <h2>Dernières recherches</h2>
        <span className="rule" />
      </div>
      {runs.length === 0 && <p className="empty">Aucune recherche lancée pour l'instant.</p>}
      {runs.map((r) => (
        <a className="list-item" key={r.id} href={`/runs/${r.id}`} style={{ textDecoration: "none", color: "inherit" }}>
          <div>
            <strong>{r.config_name || "—"}</strong>
            <div className="muted" style={{ fontSize: "0.85rem", marginTop: 2 }}>
              {new Date(r.started_at).toLocaleString("fr-FR")}
            </div>
          </div>
          <div className="row" style={{ flex: "0 0 auto", alignItems: "center" }}>
            <span className="badge">{r.status}</span>
            <span className="mono">{r.count} biens</span>
          </div>
        </a>
      ))}
    </div>
  );
}
