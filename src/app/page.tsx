"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Cfg = { id: number; name: string; criteria: any; updated_at: string };
type Run = {
  id: number;
  config_name: string;
  status: string;
  count: number;
  started_at: string;
};

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

function summarizeCpe(criteria: any): string {
  const c = criteria?.cpeClasses;
  return Array.isArray(c) && c.length ? c.join("") : "toutes";
}

export default function Dashboard() {
  const [configs, setConfigs] = useState<Cfg[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [busy, setBusy] = useState<number | null>(null);
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

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <div className="wrap">
      <div className="topbar">
        <div className="brand">
          <span className="dot" />
        </div>
        <div className="row" style={{ flex: "0 0 auto", alignItems: "center" }}>
          <a className="btn ghost" href="/tracked">★ Suivis</a>
          <a className="btn ghost" href="/settings">⚙ Prix de revente</a>
          <button className="btn ghost" onClick={logout}>Déconnexion</button>
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
        {configs.map((c) => (
          <div className="list-item" key={c.id}>
            <div>
              <strong>{c.name}</strong>
              <div className="muted" style={{ fontSize: "0.85rem", marginTop: 2 }}>
                {c.criteria?.propertyType} · ≤ {c.criteria?.surfaceMax ?? "—"} m² ·{" "}
                CPE {summarizeCpe(c.criteria)}
                {c.criteria?.includeNew ? " · neuf inclus" : ""} · {summarizeZones(c.criteria)}
              </div>
            </div>
            <div className="row" style={{ flex: "0 0 auto" }}>
              <button className="btn" onClick={() => relancer(c.id)} disabled={busy === c.id}>
                {busy === c.id ? "..." : "Relancer"}
              </button>
              <button className="btn ghost" onClick={() => supprimer(c.id)}>✕</button>
            </div>
          </div>
        ))}
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
