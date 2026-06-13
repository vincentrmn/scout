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
  confidence: number; confidence_reason: string;
  formula: string; comps: Comp[]; generated_at: string;
};
type Proposal = {
  id: number; quartier_slug: string; proposed_eur_m2: number;
  current_eur_m2: number | null; calc: Calc; created_at: string;
};

const eur = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".") + " €";
const pct = (v: number) => `${Math.round(v * 1000) / 10} %`;
const fmtDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString("fr-FR") : "—");
const ETAT_LABEL: Record<string, string> = { a_renover: "à rénover", habitable: "habitable", renove: "rénové" };

// Badge de confiance : ≥80 Élevée · 60–79 Bonne · 45–59 Modérée · <45 Faible.
function confBadge(score: number): { label: string; bg: string; fg: string } {
  if (score >= 80) return { label: "Élevée", bg: "#e7f7f1", fg: "#0a8f6c" };
  if (score >= 60) return { label: "Bonne", bg: "#eef4fb", fg: "#2b6cb0" };
  if (score >= 45) return { label: "Modérée", bg: "#fff7e6", fg: "#9a6b00" };
  return { label: "Faible", bg: "#fdecea", fg: "#c0392b" };
}

function Step({ n, title, children }: { n?: string; title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div className="muted" style={{ fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 3 }}>
        {n ? `${n}. ` : ""}{title}
      </div>
      <div style={{ fontSize: "0.9rem" }}>{children}</div>
    </div>
  );
}

function ProposalDetail({ c }: { c: Calc }) {
  const d = c.decote;
  const cb = confBadge(c.confidence);
  const renove = c.comps.filter((x) => x.etat === "renove").length;
  const habit = c.comps.filter((x) => x.etat === "habitable").length;
  const aren = c.comps.filter((x) => x.etat === "a_renover").length;
  const indet = c.comps.filter((x) => !x.etat).length;
  const basisLabel =
    c.basis === "renove" ? "médiane des rénovés"
    : c.basis === "p75" ? "P75 — le haut du marché"
    : "référence officielle VdL 2025";
  const delta = c.current_eur_m2 && c.current_eur_m2 > 0
    ? Math.round(((c.proposed_eur_m2 - c.current_eur_m2) / c.current_eur_m2) * 100) : null;

  return (
    <div style={{ background: "var(--paper-2)", borderRadius: 10, padding: "14px 16px", marginTop: 8 }}>
      <Step n="1" title="Comparables">
        {c.comps.length > 0 ? (
          <span>
            {c.comps.length} biens · {renove} rénové{renove > 1 ? "s" : ""} · {habit} habitable{habit > 1 ? "s" : ""}
            {aren ? ` · ${aren} à rénover` : ""}{indet ? ` · ${indet} indéterminé` : ""}
          </span>
        ) : (
          <span className="muted">Trop peu de comps dans le quartier — on s'appuie sur la référence officielle.</span>
        )}
      </Step>

      <Step n="2" title="Prix affiché cible">
        <span className="mono" style={{ fontWeight: 600 }}>{eur(c.cible_eur_m2)}/m²</span> — {basisLabel}
        {c.comps.length > 0 && c.percentiles.median != null && (
          <div className="muted" style={{ fontSize: "0.78rem", marginTop: 2 }}>
            P25 {eur(c.percentiles.p25 ?? 0)} · médiane {eur(c.percentiles.median)} · P75 {eur(c.percentiles.p75 ?? 0)}
          </div>
        )}
      </Step>

      <Step n="3" title="Décote affiché → signé">
        − {pct(d.decote)}{" "}
        {d.source === "fallback"
          ? <span className="muted">(fallback prudent — pas encore de données signées)</span>
          : <span className="muted">(calculée — Observatoire{d.period ? ` T_${d.period}` : ""})</span>}
      </Step>

      <Step title="= Proposition">
        <span className="mono" style={{ fontWeight: 700, fontSize: "1.05rem" }}>{eur(c.proposed_eur_m2)}/m²</span>
        <div className="mono muted" style={{ fontSize: "0.78rem", marginTop: 2 }}>{c.formula}</div>
      </Step>

      <Step title="Repères">
        <div style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: "0.86rem" }}>
          <span>
            Prix actuel : <span className="mono">{c.current_eur_m2 != null ? `${eur(c.current_eur_m2)}/m²` : "—"}</span>{" "}
            → proposé <span className="mono">{eur(c.proposed_eur_m2)}/m²</span>
            {delta != null ? ` (${delta > 0 ? "+" : ""}${delta} %)` : ""}
          </span>
          {c.vdl_ref != null && (
            <span>Réf. officielle VdL 2025 : <span className="mono">{eur(c.vdl_ref)}/m²</span></span>
          )}
          {c.confidence != null && (
            <span>
              Confiance : <span style={{ fontWeight: 700, color: cb.fg }}>{c.confidence}% {cb.label}</span>{" "}
              {c.confidence_reason && <span className="muted">— {c.confidence_reason}</span>}
            </span>
          )}
        </div>
      </Step>

      {c.comps.length > 0 && (
        <div style={{ marginTop: 6 }}>
          <div className="muted" style={{ fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
            Comparables détaillés ({c.comps.length})
          </div>
          {c.comps.map((cp) => (
            <div key={cp.listing_id} style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 8, padding: "5px 0", borderBottom: "1px solid var(--line)" }}>
              <span className="mono" style={{ fontWeight: 600, minWidth: 92 }}>{eur(cp.price_m2)}/m²</span>
              <span className="muted" style={{ fontSize: "0.8rem" }}>{cp.surface} m² · CPE {cp.cpe || "—"}</span>
              {cp.etat && (
                <span className="badge">{ETAT_LABEL[cp.etat] ?? cp.etat}{cp.etat_confidence != null ? ` ${Math.round(cp.etat_confidence * 100)}%` : ""}</span>
              )}
              {cp.url && <a href={cp.url} target="_blank" rel="noreferrer" style={{ fontSize: "0.8rem", marginLeft: "auto" }}>annonce ↗</a>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Tuto({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <div className="card" style={{ marginTop: 14 }}>
      <button className="btn ghost" onClick={onToggle}>ⓘ Comment c'est calculé {open ? "▲" : "▼"}</button>
      {open && (
        <div style={{ marginTop: 12, fontSize: "0.88rem", lineHeight: 1.55 }}>
          <p style={{ margin: "0 0 6px", fontWeight: 600 }}>Construction de la proposition</p>
          <ol style={{ margin: "0 0 12px", paddingLeft: 18 }}>
            <li><strong>Comparables</strong> — annonces atHome similaires (appartement ancien, CPE C–F, 30–70 m²), 12 semaines glissantes, dédupliquées. L'IA classe chacune : rénové / habitable / à rénover.</li>
            <li><strong>Prix affiché cible</strong> — on vise le haut du marché : ≥ 8 comps rénovés → <em>médiane des rénovés</em> ; sinon ≥ 12 comps → <em>P75</em> ; sinon repli : réf. VdL du quartier → cluster → ville.</li>
            <li><strong>Décote affiché → signé</strong> — on retire l'écart entre prix annoncé et prix signé notaire (borné 4–12 %, fallback prudent 6,5 % tant qu'on n'a pas la donnée notariale).</li>
            <li><strong>Proposition</strong> = cible × (1 − décote), arrondie aux 50 € inférieurs.</li>
          </ol>
          <p style={{ margin: "0 0 6px", fontWeight: 600 }}>Note de confiance (0–100) = base(niveau) × taille(n) × dispersion × décote</p>
          <ul style={{ margin: "0 0 8px", paddingLeft: 18 }}>
            <li><strong>base</strong> : médiane rénové 95 · P75 80 · réf VdL / cluster 60 · ville 40</li>
            <li><strong>× taille</strong> : pénalise si peu de comps</li>
            <li><strong>× dispersion</strong> : pénalise si les €/m² sont très étalés</li>
            <li><strong>× décote</strong> : calculée ×1 · fallback ×0,85</li>
          </ul>
          <p className="muted" style={{ fontSize: "0.82rem", margin: 0 }}>
            Badges : ≥ 80 Élevée · 60–79 Bonne · 45–59 Modérée · &lt; 45 Faible. On ne dépasse jamais 100 % — on n'est jamais certain.
          </p>
        </div>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const [tree, setTree] = useState<ZoneTree[]>([]);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [showHelp, setShowHelp] = useState(false);
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

      <Tuto open={showHelp} onToggle={() => setShowHelp((v) => !v)} />

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
              const score = prop?.calc?.confidence;
              const cb = score != null ? confBadge(score) : null;
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
                          {cb && (
                            <span style={{ fontSize: "0.7rem", fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: cb.bg, color: cb.fg }}>
                              {score}% {cb.label}
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
