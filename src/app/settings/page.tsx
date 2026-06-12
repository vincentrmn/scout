"use client";
import { Fragment, useEffect, useMemo, useState } from "react";
import NavMenu from "@/components/NavMenu";

type Zone = { id: string; label: string; resale_eur_per_m2: number | null };
type ZoneTree = Zone & { quartiers: Zone[] };

type Decote = {
  decote: number;
  source: "computed" | "fallback";
  affiche_median: number | null;
  signe: number | null;
  period: string | null;
  fetched_at: string | null;
  reason?: string;
};
type Comp = {
  listing_id: string; url: string | null; price: number; surface: number;
  price_m2: number; cpe: string | null; etat: string | null;
  etat_confidence: number | null; observed_at: string;
};
type Calc = {
  level: "quartier_renove" | "quartier_p75" | "vdl" | "cluster" | "ville";
  basis: "renove" | "p75" | "reference"; n_used: number; cible_eur_m2: number;
  percentiles: { p25: number | null; median: number | null; p75: number | null };
  decote: Decote; proposed_eur_m2: number; current_eur_m2: number | null;
  vdl_ref?: number | null;
  formula: string; comps: Comp[]; generated_at: string;
};
type Proposal = {
  id: number; quartier_slug: string; proposed_eur_m2: number;
  current_eur_m2: number | null; calc: Calc; created_at: string;
};

const eur = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".") + " €";
const pct = (v: number) => `${Math.round(v * 1000) / 10} %`;
const fmtDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString("fr-FR") : "—");

const LEVEL_BADGE: Record<Calc["level"], { label: (n: number) => string; bg: string; fg: string }> = {
  quartier_renove: { label: (n) => `rénové n=${n}`, bg: "#e7f7f1", fg: "#0a8f6c" },
  quartier_p75: { label: (n) => `P75 n=${n}`, bg: "var(--paper-2)", fg: "var(--ink-soft)" },
  vdl: { label: () => "VdL réf", bg: "#eef4fb", fg: "#2b6cb0" },
  cluster: { label: () => "cluster", bg: "#fff7e6", fg: "#9a6b00" },
  ville: { label: () => "ville", bg: "#fdecea", fg: "#c0392b" },
};

const ETAT_LABEL: Record<string, string> = { a_renover: "à rénover", habitable: "habitable", renove: "rénové" };

function ProposalDetail({ c }: { c: Calc }) {
  const d = c.decote;
  return (
    <div style={{ background: "var(--paper-2)", borderRadius: 10, padding: "12px 14px", marginTop: 8 }}>
      <div className="grid cols-2" style={{ gap: "4px 32px" }}>
        <div>
          <Row label="Niveau de repli" value={LEVEL_BADGE[c.level].label(c.n_used)} />
          <Row label="Prix affiché cible" value={`${eur(c.cible_eur_m2)}/m² (${c.basis === "renove" ? "médiane rénové" : "P75"})`} />
          <Row label="Percentiles €/m²" value={`P25 ${c.percentiles.p25 ?? "—"} · méd ${c.percentiles.median ?? "—"} · P75 ${c.percentiles.p75 ?? "—"}`} />
          <Row label="Proposition" value={`${eur(c.proposed_eur_m2)}/m²`} />
        </div>
        <div>
          <Row label="Décote" value={`${pct(d.decote)}${d.source === "fallback" ? " (fallback)" : ""}`} />
          <Row label="Affiché médian (ville)" value={d.affiche_median != null ? `${eur(d.affiche_median)}/m²` : "—"} />
          <Row label="Signé Observatoire" value={d.signe != null ? `${eur(d.signe)}/m²` : "—"} hint={d.period ? `T_${d.period}` : undefined} />
          <Row label="Données Observatoire" value={d.source === "fallback" ? `fallback 6,5 % — ${d.reason || ""}` : `maj ${fmtDate(d.fetched_at)}`} />
          {c.vdl_ref != null && <Row label="Réf. VdL 2025 (quartier)" value={`${eur(c.vdl_ref)}/m²`} />}
        </div>
      </div>

      <p className="mono" style={{ fontSize: "0.82rem", margin: "10px 0 4px" }}>{c.formula}</p>
      <p className="muted" style={{ fontSize: "0.74rem", margin: "0 0 10px" }}>Généré le {new Date(c.generated_at).toLocaleString("fr-FR")}</p>

      <div className="muted" style={{ fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
        Comps utilisés ({c.comps.length})
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ fontSize: "0.82rem" }}>
          <thead>
            <tr>
              <th>Annonce</th><th className="num">Prix</th><th className="num">m²</th>
              <th className="num">€/m²</th><th>CPE</th><th>État (LLM)</th><th>Vu le</th>
            </tr>
          </thead>
          <tbody>
            {c.comps.map((cp) => (
              <tr key={cp.listing_id}>
                <td>{cp.url ? <a href={cp.url} target="_blank" rel="noreferrer">{cp.listing_id}</a> : cp.listing_id}</td>
                <td className="num">{eur(cp.price)}</td>
                <td className="num">{cp.surface}</td>
                <td className="num">{eur(cp.price_m2)}</td>
                <td><span className="badge">{cp.cpe || "—"}</span></td>
                <td>{cp.etat ? `${ETAT_LABEL[cp.etat] ?? cp.etat}${cp.etat_confidence != null ? ` (${Math.round(cp.etat_confidence * 100)}%)` : ""}` : "—"}</td>
                <td className="muted">{fmtDate(cp.observed_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "4px 0", borderBottom: "1px solid var(--line)" }}>
      <span className="muted" style={{ fontSize: "0.8rem" }}>{label}{hint && <span style={{ fontStyle: "italic", marginLeft: 6 }}>{hint}</span>}</span>
      <span className="mono" style={{ fontSize: "0.82rem", textAlign: "right" }}>{value}</span>
    </div>
  );
}

export default function SettingsPage() {
  const [tree, setTree] = useState<ZoneTree[]>([]);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [recalcBusy, setRecalcBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const loadZones = async () => {
    const res = await fetch("/api/zone-prices", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const t: ZoneTree[] = json.zones || [];
    setTree(t);
    const v: Record<string, string> = {};
    for (const city of t) {
      v[city.id] = city.resale_eur_per_m2 != null ? String(city.resale_eur_per_m2) : "";
      for (const q of city.quartiers) v[q.id] = q.resale_eur_per_m2 != null ? String(q.resale_eur_per_m2) : "";
    }
    setVals(v);
  };
  const loadProposals = async () => {
    const r = await fetch("/api/proposals", { cache: "no-store" }).then((x) => x.json()).catch(() => []);
    setProposals(Array.isArray(r) ? r : []);
  };

  useEffect(() => {
    (async () => {
      try {
        await Promise.all([loadZones(), loadProposals()]);
      } catch {
        setMsg({ kind: "err", text: "Impossible de charger les prix." });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const propByQ = useMemo(() => {
    const m: Record<string, Proposal> = {};
    for (const p of proposals) m[p.quartier_slug] = p;
    return m;
  }, [proposals]);

  const period = proposals[0]?.calc?.decote?.period ?? null;

  const defaultPrice = useMemo(() => {
    const city = tree[0];
    if (!city) return 0;
    const raw = vals[city.id];
    return raw && raw.trim() !== "" ? Number(raw) : 0;
  }, [tree, vals]);

  function set(id: string, value: string) {
    setVals((p) => ({ ...p, [id]: value }));
    setMsg(null);
  }

  async function save() {
    setBusy(true); setMsg(null);
    const prices: Record<string, number | null> = {};
    for (const [id, v] of Object.entries(vals)) prices[id] = v.trim() === "" ? null : Number(v);
    const res = await fetch("/api/zone-prices", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prices }) });
    setBusy(false);
    if (res.ok) setMsg({ kind: "ok", text: "Prix enregistrés." });
    else { const d = await res.json().catch(() => ({})); setMsg({ kind: "err", text: d.error || "Erreur à l'enregistrement." }); }
  }

  async function recalc() {
    setRecalcBusy(true); setMsg(null);
    const res = await fetch("/api/proposals/recalc", { method: "POST" });
    setRecalcBusy(false);
    if (res.ok) { const d = await res.json().catch(() => ({})); setMsg({ kind: "ok", text: `${d.created ?? 0} proposition(s) générée(s).` }); await loadProposals(); }
    else { const d = await res.json().catch(() => ({})); setMsg({ kind: "err", text: d.error || "Erreur au recalcul." }); }
  }

  async function decide(p: Proposal, action: "accept" | "dismiss") {
    await fetch("/api/proposals", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: p.id, action }) }).catch(() => {});
    if (action === "accept") setVals((v) => ({ ...v, [p.quartier_slug]: String(p.proposed_eur_m2) }));
    setProposals((prev) => prev.filter((x) => x.id !== p.id));
  }

  return (
    <div className="wrap">
      <div className="topbar">
        <a className="brand-home" href="/" title="Accueil">SCOUT</a>
        <h1 className="page-title">Prix de revente</h1>
        <div className="topbar-nav">
          <NavMenu links={[{ href: "/", label: "← Retour" }]} />
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <p className="muted" style={{ margin: 0, flex: 1, minWidth: 240 }}>
          Prix de revente cible au m² par quartier. La saisie manuelle reste prioritaire ; les propositions sont calculées (jamais appliquées sans clic).
        </p>
        <button className="btn ghost" onClick={recalc} disabled={recalcBusy || loading}>
          {recalcBusy ? "Calcul…" : "↻ Recalculer maintenant"}
        </button>
      </div>

      {proposals.length > 0 && (
        <div className="card" style={{ marginTop: 14, borderColor: "var(--green)", background: "var(--green-soft)" }}>
          <strong>{proposals.length} proposition{proposals.length > 1 ? "s" : ""} de mise à jour</strong>
          {period && <span className="muted"> (données Observatoire T_{period})</span>} — à valider quartier par quartier ci-dessous.
        </div>
      )}

      {loading && <p className="empty">Chargement…</p>}

      {!loading && tree.map((city) => (
        <div key={city.id} style={{ marginBottom: 22 }}>
          <div className="card" style={{ marginTop: 14 }}>
            <label>Prix par défaut — {city.label} (€/m²)</label>
            <input type="number" value={vals[city.id] ?? ""} onChange={(e) => set(city.id, e.target.value)} placeholder="ex : 11000" style={{ maxWidth: 220 }} />
            <p className="muted" style={{ fontSize: "0.8rem", marginBottom: 0, marginTop: 8 }}>Appliqué à tout quartier non calibré ci-dessous.</p>
          </div>

          <div className="section-title"><h2>Quartiers</h2><span className="rule" /></div>

          <div className="card" style={{ padding: "8px 16px" }}>
            {city.quartiers.map((q) => {
              const prop = propByQ[q.id];
              const isOpen = !!open[q.id];
              const badge = prop ? LEVEL_BADGE[prop.calc.level] : null;
              return (
                <Fragment key={q.id}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
                    <div style={{ flex: "1 1 160px", display: "flex", alignItems: "center", gap: 8 }}>
                      {prop && (
                        <button className={`expand-btn ${isOpen ? "open" : ""}`} title="Détail du calcul" onClick={() => setOpen((o) => ({ ...o, [q.id]: !o[q.id] }))}>▸</button>
                      )}
                      <strong style={{ fontWeight: 600 }}>{q.label}</strong>
                    </div>
                    <div style={{ flex: "0 0 auto" }}>
                      <input type="number" value={vals[q.id] ?? ""} onChange={(e) => set(q.id, e.target.value)} placeholder={defaultPrice ? `défaut ${defaultPrice}` : "défaut"} style={{ width: 130 }} title="Prix actuel (saisie manuelle, prioritaire)" />
                    </div>
                    <div style={{ flex: "1 1 220px", display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                      {prop ? (
                        <>
                          <span className="mono" style={{ fontWeight: 600 }}>{eur(prop.proposed_eur_m2)}/m²</span>
                          {badge && (
                            <span style={{ fontSize: "0.7rem", fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: badge.bg, color: badge.fg }}>
                              {badge.label(prop.calc.n_used)}
                            </span>
                          )}
                          <button className="btn green" onClick={() => decide(prop, "accept")}>Appliquer</button>
                          <button className="btn ghost" onClick={() => decide(prop, "dismiss")}>Ignorer</button>
                        </>
                      ) : (
                        <span className="muted" style={{ fontSize: "0.82rem" }}>—</span>
                      )}
                    </div>
                  </div>
                  {prop && isOpen && (
                    <div style={{ padding: "0 0 12px" }}><ProposalDetail c={prop.calc} /></div>
                  )}
                </Fragment>
              );
            })}
          </div>
        </div>
      ))}

      {msg && (
        <div className={msg.kind === "err" ? "error" : ""} style={msg.kind === "ok" ? { color: "var(--green-ink)", fontWeight: 600 } : undefined}>{msg.text}</div>
      )}

      <div className="row" style={{ marginTop: 18 }}>
        <button className="btn clay" onClick={save} disabled={busy || loading}>{busy ? "..." : "Enregistrer les prix"}</button>
      </div>
    </div>
  );
}
