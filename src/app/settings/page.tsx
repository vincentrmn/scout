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
  current_eur_m2: number | null; calc: Calc; status: "pending" | "accepted";
  created_at: string; decided_at?: string | null;
};

const eur = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".") + " €";
const pct = (v: number) => `${Math.round(v * 1000) / 10} %`;
const ETAT_LABEL: Record<string, string> = { a_renover: "à rénover", habitable: "habitable", renove: "rénové" };
const ETAT_CODE: Record<string, string> = { a_renover: "A", habitable: "H", renove: "R" };

// Badge de confiance : ≥80 Élevée · 60–79 Bonne · 45–59 Modérée · <45 Faible.
function confBadge(score: number): { label: string; bg: string; fg: string } {
  if (score >= 80) return { label: "Élevée", bg: "#e7f7f1", fg: "#0a8f6c" };
  if (score >= 60) return { label: "Bonne", bg: "#eef4fb", fg: "#2b6cb0" };
  if (score >= 45) return { label: "Modérée", bg: "#fff7e6", fg: "#9a6b00" };
  return { label: "Faible", bg: "#fdecea", fg: "#c0392b" };
}

// Phrase décrivant le niveau retenu (médiane rénové / P75 quartier / cluster / ville / réf VdL).
function methodLine(c: Calc): string {
  if (c.basis === "reference") return "Référence Observatoire de l'Habitat (par quartier, 2025)";
  const n = `${c.n_used} comparable${c.n_used > 1 ? "s" : ""}`;
  if (c.basis === "renove") return `Médiane des biens rénovés · ${n}`;
  if (c.level === "ville") return `P75 ville (repli, faute de comps locaux) · ${n}`;
  if (c.level === "cluster") return `P75 du cluster de quartiers voisins · ${n}`;
  return `P75 du quartier · ${n}`;
}

function ProposalDetail({ c }: { c: Calc }) {
  const d = c.decote;
  const cb = confBadge(c.confidence);
  const renove = c.comps.filter((x) => x.etat === "renove").length;
  const habit = c.comps.filter((x) => x.etat === "habitable").length;
  const aren = c.comps.filter((x) => x.etat === "a_renover").length;
  const indet = c.comps.filter((x) => !x.etat).length;
  const parts = [
    renove && `${renove} rénové${renove > 1 ? "s" : ""}`,
    habit && `${habit} habitable${habit > 1 ? "s" : ""}`,
    aren && `${aren} à rénover`,
    indet && `${indet} indéterminé${indet > 1 ? "s" : ""}`,
  ].filter(Boolean);
  const delta = c.current_eur_m2 && c.current_eur_m2 > 0
    ? Math.round(((c.proposed_eur_m2 - c.current_eur_m2) / c.current_eur_m2) * 100) : null;

  return (
    <div className="prop-detail">
      <p className="pd-method">{methodLine(c)}</p>
      {parts.length > 0 && <p className="pd-sub">{parts.join(" · ")}</p>}

      <div className="pd-eq">
        <span className="eq-term">{eur(c.cible_eur_m2)}/m²</span>
        <span className="eq-op">× (1 − {pct(d.decote)})</span>
        <span className="eq-op">=</span>
        <span className="eq-res">{eur(c.proposed_eur_m2)}/m²</span>
      </div>
      <p className="pd-eq-note">
        prix affiché cible × décote{" "}
        {d.source === "fallback"
          ? "prudente (pas encore de données notariales)"
          : `mesurée (Observatoire${d.period ? ` ${d.period}` : ""})`}
        {" "}→ arrondi aux 50 € inférieurs
      </p>

      {c.comps.length > 0 && c.percentiles.median != null && (
        <>
          <div className="pd-h">Distribution des prix affichés (€/m²)</div>
          <dl className="pd-kv">
            <dt>P25</dt><dd>{eur(c.percentiles.p25 ?? 0)}</dd>
            <dt>Médiane</dt><dd>{eur(c.percentiles.median)}</dd>
            <dt>P75</dt><dd>{eur(c.percentiles.p75 ?? 0)}</dd>
          </dl>
        </>
      )}

      <div className="pd-h">Repères</div>
      <dl className="pd-kv">
        <dt>Prix actuel</dt>
        <dd>
          {c.current_eur_m2 != null ? `${eur(c.current_eur_m2)}/m²` : "—"} → {eur(c.proposed_eur_m2)}/m²
          {delta != null ? ` (${delta > 0 ? "+" : ""}${delta} %)` : ""}
        </dd>
        {c.vdl_ref != null && (
          <>
            <dt>Réf. Observatoire</dt><dd>{eur(c.vdl_ref)}/m²</dd>
          </>
        )}
        <dt>Confiance</dt>
        <dd>
          <span className="conf-chip" style={{ background: cb.bg, color: cb.fg }}>{c.confidence}% · {cb.label}</span>
          {c.confidence_reason && <span className="muted"> — {c.confidence_reason}</span>}
        </dd>
      </dl>

      {c.comps.length > 0 && (
        <>
          <div className="pd-h">Comparables ({c.comps.length})</div>
          {c.comps.map((cp) => (
            <div key={cp.listing_id} className="comp-row">
              <span className="cm-price">{eur(cp.price_m2)}/m²</span>
              <span className="cm-meta">
                {cp.surface} m² · CPE {cp.cpe || "—"}
                {cp.etat ? ` · ${ETAT_CODE[cp.etat] ?? "?"}${cp.etat_confidence != null ? ` (${Math.round(cp.etat_confidence * 100)}%)` : ""}` : ""}
              </span>
              {cp.url
                ? <a className="cm-link" href={cp.url} target="_blank" rel="noreferrer" title="Voir l'annonce" aria-label="Voir l'annonce">↗</a>
                : <span className="cm-link muted">—</span>}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// Tuto intégré dans la carte d'intro (pas un cadre orphelin).
function MethodHelp() {
  return (
    <div className="method-help">
      <h4>Comment la proposition est calculée</h4>
      <ol>
        <li>
          <dfn>Comparables</dfn> — les annonces atHome ressemblant à une cible d'investissement :
          appartement ancien, CPE C à F, 30 à 70 m², sur les 12 dernières semaines, dédoublonnées.
          Chacune est classée par IA (voir plus bas).
        </li>
        <li>
          <dfn>Prix affiché cible</dfn> — le prix de revente visé, au m². On prend le premier niveau
          disponible, du plus fiable au plus large :
          <ul>
            <li><dfn>Médiane des rénovés</dfn> dès qu'on a ≥ 8 biens rénovés dans le quartier — le cœur du marché rénové.</li>
            <li><dfn>P75 du quartier</dfn> sinon, dès ≥ 12 comparables — le 75ᵉ centile, c.-à-d. le haut du marché (¾ des biens sont en dessous).</li>
            <li><dfn>Référence Observatoire</dfn> sinon — le prix annoncé par quartier publié par l'Observatoire de l'Habitat (chiffre officiel, par quartier de la Ville de Luxembourg).</li>
            <li><dfn>Cluster</dfn> sinon — un groupe de quartiers voisins comparables, dont on mutualise les comps quand le quartier seul en manque.</li>
            <li><dfn>P75 ville</dfn> en tout dernier recours — calculé sur nos annonces, toute la ville confondue. À distinguer de la <em>Référence Observatoire</em> (chiffre officiel par quartier) : ici c'est notre propre P75 issu du scraping, toute la ville.</li>
          </ul>
        </li>
        <li>
          <dfn>Décote affiché → signé</dfn> — l'écart entre le prix annoncé et le prix réellement signé chez le notaire.
          Mesurée sur les données de l'Observatoire de l'Habitat (bornée 4 à 12 %), avec un repli prudent à 6,5 % tant qu'on n'a pas la donnée notariale.
        </li>
        <li>
          <dfn>Proposition</dfn> = prix affiché cible × (1 − décote), arrondie aux 50 € inférieurs.
          La saisie manuelle reste toujours prioritaire : rien n'est appliqué sans ton clic.
        </li>
      </ol>

      <h4>Le classement par IA (R / H / A)</h4>
      <p style={{ margin: "0 0 6px" }}>
        Le titre et la description de chaque annonce sont envoyés à un modèle de langage
        (Claude Haiku) qui juge l'état du bien et le range dans une catégorie, avec un
        pourcentage de confiance dans son verdict. C'est ce code qui apparaît dans la liste
        des comparables, ex. <code>H (90 %)</code> = jugé habitable, confiance 90 %.
      </p>
      <ul>
        <li><dfn>R</dfn> — rénové : refait à neuf, prêt à revendre au prix haut.</li>
        <li><dfn>H</dfn> — habitable : correct, sans gros travaux, mais pas rénové récemment.</li>
        <li><dfn>A</dfn> — à rénover : travaux nécessaires.</li>
      </ul>
      <p className="pd-sub" style={{ margin: "0 0 4px" }}>
        Ce classement sert à viser la médiane des seuls biens rénovés quand on en a assez (≥ 8) :
        on se compare à des biens dans l'état où on revendra, pas à des biens à retaper.
      </p>

      <h4>Note de confiance</h4>
      <p style={{ margin: "0 0 6px" }}>
        Un score 0–100 = <strong>base</strong> (selon le niveau retenu) × <strong>taille</strong> (nombre de comps)
        × <strong>dispersion</strong> (étalement des €/m²) × <strong>décote</strong> (mesurée ou repli).
      </p>
      <ul>
        <li><dfn>base</dfn> : médiane rénové 95 · P75 quartier 80 · réf Observatoire / cluster 60 · ville 40</li>
        <li><dfn>taille</dfn> : abaisse le score quand il y a peu de comparables</li>
        <li><dfn>dispersion</dfn> : abaisse le score quand les prix sont très étalés</li>
        <li><dfn>décote</dfn> : ×1 si mesurée, ×0,85 si repli prudent</li>
      </ul>
      <div className="legend">
        <span className="conf-chip" style={{ background: "#e7f7f1", color: "#0a8f6c" }}>≥ 80 · Élevée</span>
        <span className="conf-chip" style={{ background: "#eef4fb", color: "#2b6cb0" }}>60–79 · Bonne</span>
        <span className="conf-chip" style={{ background: "#fff7e6", color: "#9a6b00" }}>45–59 · Modérée</span>
        <span className="conf-chip" style={{ background: "#fdecea", color: "#c0392b" }}>&lt; 45 · Faible</span>
      </div>
      <p className="pd-sub" style={{ marginTop: 8 }}>On ne dépasse jamais 100 % : on n'est jamais certain.</p>
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
  const pendingCount = useMemo(() => proposals.filter((p) => p.status === "pending").length, [proposals]);

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
    if (action === "accept") {
      // On garde la proposition (statut « appliqué ») pour conserver le détail.
      setVals((v) => ({ ...v, [p.quartier_slug]: String(p.proposed_eur_m2) }));
      setProposals((prev) => prev.map((x) => (x.id === p.id ? { ...x, status: "accepted" } : x)));
    } else {
      setProposals((prev) => prev.filter((x) => x.id !== p.id));
    }
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

      <div className="card" style={{ marginTop: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <p className="muted" style={{ margin: 0, flex: 1, minWidth: 240 }}>
            Prix de revente cible au m² par quartier. La saisie manuelle reste prioritaire ;
            les propositions sont calculées automatiquement et ne s'appliquent qu'à ton clic.
          </p>
          <button className="btn ghost" onClick={recalc} disabled={recalcBusy || loading}>
            {recalcBusy ? "Calcul…" : "↻ Recalculer"}
          </button>
        </div>
        <button className="btn ghost" style={{ marginTop: 10 }} onClick={() => setShowHelp((v) => !v)}>
          ⓘ Comment c'est calculé {showHelp ? "▲" : "▼"}
        </button>
        {showHelp && <MethodHelp />}
      </div>

      {pendingCount > 0 && (
        <div className="card" style={{ marginTop: 14, borderColor: "var(--green)", background: "var(--green-soft)" }}>
          <strong>{pendingCount} proposition{pendingCount > 1 ? "s" : ""} de mise à jour</strong>
          {period && <span className="muted"> (données Observatoire {period})</span>} — à valider quartier par quartier ci-dessous.
        </div>
      )}

      {loading && <p className="empty">Chargement…</p>}

      {!loading && tree.map((city) => (
        <div key={city.id} style={{ marginBottom: 22 }}>
          <div className="card" style={{ marginTop: 14 }}>
            <label>Prix par défaut — {city.label} (€/m²)</label>
            <input type="number" value={vals[city.id] ?? ""} onChange={(e) => set(city.id, e.target.value)} placeholder="ex : 11000" style={{ maxWidth: 220 }} />
            <p className="muted" style={{ fontSize: "0.8rem", marginBottom: 0, marginTop: 8 }}>Appliqué à tout quartier non calibré ci-dessous.</p>
            {(() => {
              const prop = propByQ[city.id];
              if (!prop) return null;
              const isOpen = !!open[city.id];
              const score = prop.calc?.confidence;
              const cb = score != null ? confBadge(score) : null;
              return (
                <div style={{ marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
                  <div className="q-action">
                    <button className={`expand-btn ${isOpen ? "open" : ""}`} title="Détail du calcul" onClick={() => setOpen((o) => ({ ...o, [city.id]: !o[city.id] }))}>▸</button>
                    <span className="mono" style={{ fontWeight: 600 }}>Proposition ville : {eur(prop.proposed_eur_m2)}/m²</span>
                    {cb && <span className="conf-chip" style={{ background: cb.bg, color: cb.fg }}>{score}% · {cb.label}</span>}
                    {prop.status === "accepted" ? (
                      <span className="muted" style={{ fontSize: "0.82rem", fontWeight: 600 }}>✓ Appliqué</span>
                    ) : (
                      <div className="q-btns">
                        <button className="btn green" onClick={() => decide(prop, "accept")}>Appliquer</button>
                        <button className="btn ghost" onClick={() => decide(prop, "dismiss")}>Ignorer</button>
                      </div>
                    )}
                  </div>
                  {isOpen && <ProposalDetail c={prop.calc} />}
                </div>
              );
            })()}
          </div>

          <div className="section-title"><h2>Quartiers</h2><span className="rule" /></div>

          <div className="card" style={{ padding: "4px 16px" }}>
            {city.quartiers.map((q) => {
              const prop = propByQ[q.id];
              const isOpen = !!open[q.id];
              const score = prop?.calc?.confidence;
              const cb = score != null ? confBadge(score) : null;
              return (
                <div className="q-row" key={q.id}>
                  <div className="q-name">
                    {prop && (
                      <button className={`expand-btn ${isOpen ? "open" : ""}`} title="Détail du calcul" onClick={() => setOpen((o) => ({ ...o, [q.id]: !o[q.id] }))}>▸</button>
                    )}
                    <strong>{q.label}</strong>
                  </div>
                  <input className="q-input" type="number" value={vals[q.id] ?? ""} onChange={(e) => set(q.id, e.target.value)} placeholder={defaultPrice ? `défaut ${defaultPrice}` : "défaut"} title="Prix actuel (saisie manuelle, prioritaire)" />

                  {prop ? (
                    <div className="q-action">
                      <span className="mono" style={{ fontWeight: 600 }}>→ {eur(prop.proposed_eur_m2)}/m²</span>
                      {cb && (
                        <span className="conf-chip" style={{ background: cb.bg, color: cb.fg }}>{score}% · {cb.label}</span>
                      )}
                      {prop.status === "accepted" ? (
                        <span className="muted" style={{ fontSize: "0.82rem", fontWeight: 600 }}>✓ Appliqué</span>
                      ) : (
                        <div className="q-btns">
                          <button className="btn green" onClick={() => decide(prop, "accept")}>Appliquer</button>
                          <button className="btn ghost" onClick={() => decide(prop, "dismiss")}>Ignorer</button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="q-action"><span className="muted" style={{ fontSize: "0.82rem" }}>Pas de proposition</span></div>
                  )}

                  {prop && isOpen && (
                    <div className="q-detail"><ProposalDetail c={prop.calc} /></div>
                  )}
                </div>
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
