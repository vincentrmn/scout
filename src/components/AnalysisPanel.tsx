"use client";
import { useState } from "react";
import { scoreListing, type ScoringSnapshot } from "@/lib/scoring";

/**
 * S9 — Panneau d'analyse d'un bien suivi.
 * Affiche le detail du calcul avec les hypotheses de la recherche d'origine,
 * et permet de les modifier pour un essai de rentabilite (recalcul en direct,
 * Enregistrer = persiste et partage, Reinitialiser = revient a la recherche).
 */

type ListingBase = {
  id: string;
  url?: string;
  price: number;
  surface: number;
  commune?: string;
  cpe?: string;
};

const eur = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".") + " €";
const pctLabel = (v: number) => `${Math.round(v * 1000) / 10} %`;
const FIELDS: (keyof ScoringSnapshot)[] = [
  "worksEurPerM2", "worksVatPct", "notaryPct", "resaleAgencyPct", "targetMarginPct", "resalePerM2",
];
const sameScoring = (a: ScoringSnapshot, b: ScoringSnapshot) =>
  FIELDS.every((f) => Math.abs(a[f] - b[f]) < 1e-9);

function DetailRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "5px 0", borderBottom: "1px solid var(--line)" }}>
      <span className="muted" style={{ fontSize: "0.82rem" }}>
        {label}
        {hint && <span style={{ fontStyle: "italic", marginLeft: 6 }}>{hint}</span>}
      </span>
      <span className="mono" style={{ fontSize: "0.85rem" }}>{value}</span>
    </div>
  );
}

export default function AnalysisPanel({
  listing,
  baseline,
  analysis,
  priceIsDefault,
  onSaved,
}: {
  listing: ListingBase;
  baseline: ScoringSnapshot;
  analysis: ScoringSnapshot | null;
  priceIsDefault: boolean;
  onSaved: () => void;
}) {
  // Etat de l'essai en cours : l'override enregistre, sinon les hypotheses de la recherche.
  const [trial, setTrial] = useState<ScoringSnapshot>(analysis ?? baseline);
  const [busy, setBusy] = useState(false);

  // Recalcul en direct (scoreListing est pur, sans dependance serveur).
  const s = scoreListing(
    { id: listing.id, url: listing.url ?? "", price: listing.price, surface: listing.surface, commune: listing.commune, cpe: listing.cpe },
    {
      worksEurPerM2: trial.worksEurPerM2,
      worksVatPct: trial.worksVatPct,
      notaryPct: trial.notaryPct,
      resaleAgencyPct: trial.resaleAgencyPct,
      targetMarginPct: trial.targetMarginPct,
    },
    trial.resalePerM2,
    priceIsDefault
  );

  const saved = analysis ?? baseline;             // ce qui est actuellement effectif en base
  const dirty = !sameScoring(trial, saved);       // modifie vs etat enregistre
  const customResale = Math.abs(trial.resalePerM2 - baseline.resalePerM2) > 1e-9;
  const resaleHint =
    `${Math.round(trial.resalePerM2).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")} €/m² ` +
    (customResale ? "(essai)" : priceIsDefault ? "(défaut)" : "(zone)");

  const num = (v: string) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };
  const setField = (f: keyof ScoringSnapshot, value: number) =>
    setTrial((p) => ({ ...p, [f]: value }));

  const save = async () => {
    setBusy(true);
    await fetch("/api/listings/analysis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: listing.id, scoring: trial }),
    }).catch(() => {});
    setBusy(false);
    onSaved();
  };

  const reset = async () => {
    setBusy(true);
    setTrial(baseline);
    if (analysis) {
      await fetch("/api/listings/analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: listing.id, scoring: null }),
      }).catch(() => {});
      onSaved();
    }
    setBusy(false);
  };

  return (
    <div>
      <div className="grid cols-2" style={{ gap: "2px 32px" }}>
        <div>
          <DetailRow label="Prix affiché" value={eur(listing.price)} />
          <DetailRow label="Revente estimée" value={eur(s.resaleValue)} hint={resaleHint} />
          <DetailRow label={`Travaux TTC (TVA ${pctLabel(trial.worksVatPct)})`} value={eur(s.worksCost)} />
          <DetailRow label={`Frais acquisition (${pctLabel(trial.notaryPct)})`} value={eur(s.acquisitionCost)} />
          <DetailRow label={`Frais revente (${pctLabel(trial.resaleAgencyPct)})`} value={eur(s.resaleCost)} />
        </div>
        <div>
          <DetailRow label="Capital investi" value={eur(s.totalInvested)} />
          <DetailRow label="Bénéfice brut" value={eur(s.netProfit)} />
          <DetailRow label="Marge brute" value={`${s.marginPct} %`} />
          <DetailRow label={`Prix d'achat max (cible ${pctLabel(trial.targetMarginPct)})`} value={eur(s.maxBuyPrice)} />
        </div>
      </div>

      {/* Editeur d'hypotheses — essai de rentabilite */}
      <div style={{ marginTop: 16 }}>
        <div className="muted" style={{ fontSize: "0.78rem", marginBottom: 8, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
          Hypothèses (essai de rentabilité)
          {analysis && <span className="badge" style={{ fontSize: "0.68rem" }}>essai enregistré</span>}
        </div>
        <div className="grid cols-2" style={{ gap: "10px 32px", maxWidth: 640 }}>
          <NumField label="Travaux HT (€/m²)" value={trial.worksEurPerM2} onChange={(v) => setField("worksEurPerM2", v)} />
          <NumField label="Prix de revente (€/m²)" value={trial.resalePerM2} onChange={(v) => setField("resalePerM2", v)} />
          <PctField label="TVA travaux (%)" value={trial.worksVatPct} onChange={(v) => setField("worksVatPct", v)} />
          <PctField label="Frais acquisition (%)" value={trial.notaryPct} onChange={(v) => setField("notaryPct", v)} />
          <PctField label="Frais revente (%)" value={trial.resaleAgencyPct} onChange={(v) => setField("resaleAgencyPct", v)} />
          <PctField label="Marge brute cible (%)" value={trial.targetMarginPct} onChange={(v) => setField("targetMarginPct", v)} />
        </div>
        <div className="row" style={{ marginTop: 12, gap: 8 }}>
          <button className="btn green" onClick={save} disabled={busy || !dirty} style={{ flex: "0 0 auto" }}>
            Enregistrer l'essai
          </button>
          <button className="btn ghost" onClick={reset} disabled={busy || (!analysis && !dirty)} style={{ flex: "0 0 auto" }}>
            Réinitialiser
          </button>
        </div>
      </div>
    </div>
  );
}

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label style={{ display: "block" }}>
      <span className="muted" style={{ fontSize: "0.78rem", display: "block", marginBottom: 3 }}>{label}</span>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => { const n = parseFloat(e.target.value); onChange(Number.isFinite(n) ? n : 0); }}
        style={{ width: "100%", padding: "7px 9px" }}
      />
    </label>
  );
}

// Champ en pourcentage : affiche 17, stocke 0.17.
function PctField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label style={{ display: "block" }}>
      <span className="muted" style={{ fontSize: "0.78rem", display: "block", marginBottom: 3 }}>{label}</span>
      <input
        type="number"
        step="0.1"
        value={Math.round(value * 1000) / 10}
        onChange={(e) => { const n = parseFloat(e.target.value); onChange(Number.isFinite(n) ? n / 100 : 0); }}
        style={{ width: "100%", padding: "7px 9px" }}
      />
    </label>
  );
}
