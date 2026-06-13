"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import ZonePicker from "./ZonePicker";

const CPE = ["A", "B", "C", "D", "E", "F", "G", "H", "I"];

/** Interrupteur reutilisable, base sur le markup .toggle-switch de globals.css. */
function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="toggle-switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-switch__slider" />
    </label>
  );
}

export default function NewSearch() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [propertyType, setPropertyType] = useState("apartment");
  // S3 — false = bien existant uniquement (defaut), true = neuf inclus.
  const [includeNew, setIncludeNew] = useState(false);
  // Défaut : tout Luxembourg-Ville activé via le toggle
  const [locCodes, setLocCodes] = useState<string[]>(["L9-luxembourg"]);
  const [surfaceMin, setSurfaceMin] = useState("");
  const [surfaceMax, setSurfaceMax] = useState("50");
  const [priceMin, setPriceMin] = useState("");
  const [priceMax, setPriceMax] = useState("");
  // S3 — toggle "Toutes les notes CPE" ON par defaut (cpeClasses = []).
  const [allCpe, setAllCpe] = useState(true);
  const [cpe, setCpe] = useState<string[]>([...CPE]);
  // S13 — quand on filtre par classes, inclure aussi les biens sans note de CPE.
  const [includeNoCpe, setIncludeNoCpe] = useState(false);

  // scoring — S4 : le prix de revente n'est plus ici (calibre par zone dans Reglages).
  const [worksEurPerM2, setWorks] = useState("1500");
  const [worksVatPct, setWorksVat] = useState("17");
  const [notaryPct, setNotary] = useState("8");
  const [resaleAgencyPct, setAgency] = useState("3");
  const [targetMarginPct, setMargin] = useState("15");

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  function toggleCpe(c: string) {
    setCpe((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  }

  function buildPayload() {
    const num = (v: string) => (v.trim() === "" ? undefined : Number(v));
    return {
      name: name.trim() || "Recherche sans nom",
      criteria: {
        propertyType,
        locCodes,
        includeNew,
        surfaceMin: num(surfaceMin),
        surfaceMax: num(surfaceMax),
        priceMin: num(priceMin),
        priceMax: num(priceMax),
        cpeClasses: allCpe ? [] : cpe,
        // Sans objet si « Toutes les notes CPE » est actif (déjà tout inclus).
        includeNoCpe: allCpe ? false : includeNoCpe,
      },
      scoring: {
        worksEurPerM2: Number(worksEurPerM2),
        worksVatPct: Number(worksVatPct) / 100,
        notaryPct: Number(notaryPct) / 100,
        resaleAgencyPct: Number(resaleAgencyPct) / 100,
        targetMarginPct: Number(targetMarginPct) / 100,
      },
    };
  }

  async function save(thenRun: boolean) {
    if (locCodes.length === 0) {
      setErr("Sélectionne au moins une zone (toggle « Tout » ou un ou plusieurs quartiers).");
      return;
    }
    if (!allCpe && cpe.length === 0) {
      setErr("Sélectionne au moins une note CPE, ou réactive « Toutes les notes CPE ».");
      return;
    }
    setBusy(true);
    setErr("");
    const res = await fetch("/api/configs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildPayload()),
    });
    const data = await res.json();
    if (!res.ok) {
      setBusy(false);
      setErr(data.error || "Erreur");
      return;
    }
    if (!thenRun) {
      router.push("/");
      return;
    }
    const trig = await fetch("/api/trigger", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ configId: data.id }),
    });
    const t = await trig.json();
    setBusy(false);
    if (t.runId) router.push(`/runs/${t.runId}`);
    else router.push("/");
  }

  return (
    <div className="wrap">
      <div className="topbar">
        <a className="brand-home" href="/" title="Accueil">SCOUT</a>
        <h1 className="page-title">Nouvelle recherche</h1>
        <div className="topbar-nav">
          <a className="btn ghost" href="/">← Retour</a>
        </div>
      </div>

      <div className="card">
        <label>Nom de la recherche</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex : F+ < 50m² Luxembourg-ville" />

        <div className="zone-picker__toggle-row" style={{ marginTop: 18, borderBottom: "none", paddingBottom: 0, marginBottom: 0 }}>
          <Toggle checked={includeNew} onChange={setIncludeNew} />
          <span className="zone-picker__toggle-label">
            {includeNew ? "Tous les biens (neuf inclus)" : "Bien existant uniquement"}
          </span>
        </div>
        {includeNew && (
          <p className="zone-picker__hint" style={{ marginTop: 6 }}>
            Inclut les programmes neufs en construction. Sans filtre CPE côté atHome, une recherche large peut être plus lente.
          </p>
        )}

        <div className="row" style={{ marginTop: 16 }}>
          <div>
            <label>Type de bien</label>
            <select value={propertyType} onChange={(e) => setPropertyType(e.target.value)}>
              <option value="apartment">Appartement</option>
              <option value="house">Maison</option>
              <option value="both">Les deux</option>
            </select>
          </div>
        </div>

        <div style={{ marginTop: 18 }}>
          <label>Localisation</label>
          <ZonePicker value={locCodes} onChange={setLocCodes} />
        </div>

        <div className="row" style={{ marginTop: 16 }}>
          <div><label>Surface min (m²)</label><input type="number" value={surfaceMin} onChange={(e) => setSurfaceMin(e.target.value)} /></div>
          <div><label>Surface max (m²)</label><input type="number" value={surfaceMax} onChange={(e) => setSurfaceMax(e.target.value)} /></div>
          <div><label>Prix min (€)</label><input type="number" value={priceMin} onChange={(e) => setPriceMin(e.target.value)} /></div>
          <div><label>Prix max (€)</label><input type="number" value={priceMax} onChange={(e) => setPriceMax(e.target.value)} /></div>
        </div>

        <div style={{ marginTop: 16 }}>
          <label>Classes énergétiques</label>
          <div className="zone-picker__toggle-row" style={{ borderBottom: "none", paddingBottom: 0, marginBottom: 0 }}>
            <Toggle checked={allCpe} onChange={setAllCpe} />
            <span className="zone-picker__toggle-label">Toutes les notes CPE</span>
          </div>
          {!allCpe && (
            <>
              <div className="chips" style={{ marginTop: 12 }}>
                {CPE.map((c) => (
                  <span key={c} className={`chip ${cpe.includes(c) ? "on" : ""}`} onClick={() => toggleCpe(c)}>{c}</span>
                ))}
              </div>
              <div className="zone-picker__toggle-row" style={{ marginTop: 14, borderBottom: "none", paddingBottom: 0, marginBottom: 0 }}>
                <Toggle checked={includeNoCpe} onChange={setIncludeNoCpe} />
                <span className="zone-picker__toggle-label">Inclure les biens sans note de CPE</span>
              </div>
              <p className="zone-picker__hint" style={{ marginTop: 6 }}>
                Garde aussi les annonces dont le CPE est « en cours d'élaboration » (pour ne pas rater une pépite).
                Scrape alors toutes les notes puis filtre après coup : recherche un peu plus lente.
              </p>
            </>
          )}
        </div>
      </div>

      <div className="section-title">
        <h2>Paramètres de scoring</h2>
        <span className="rule" />
      </div>
      <div className="card">
        <div className="row">
          <div><label>Travaux (€/m²)</label><input type="number" value={worksEurPerM2} onChange={(e) => setWorks(e.target.value)} /></div>
          <div><label>TVA travaux (%)</label><input type="number" value={worksVatPct} onChange={(e) => setWorksVat(e.target.value)} /></div>
        </div>
        <div className="row" style={{ marginTop: 16 }}>
          <div><label>Frais acquisition (%)</label><input type="number" value={notaryPct} onChange={(e) => setNotary(e.target.value)} /></div>
          <div><label>Frais revente (%)</label><input type="number" value={resaleAgencyPct} onChange={(e) => setAgency(e.target.value)} /></div>
          <div><label>Marge brute cible (%)</label><input type="number" value={targetMarginPct} onChange={(e) => setMargin(e.target.value)} /></div>
        </div>
        <p className="muted" style={{ fontSize: "0.82rem", marginBottom: 0 }}>
          Le prix de revente au m² est calibré par quartier dans <a href="/settings">Prix de revente</a>.
          Le verdict OK/Négocier/KO et le prix d'achat max sont recalculés à chaque run
          (OK : marge ≥ cible · Négocier : ≥ moitié de la cible · KO : en dessous).
        </p>
      </div>

      {err && <div className="error">{err}</div>}

      <div className="row" style={{ marginTop: 22 }}>
        <button className="btn clay" onClick={() => save(true)} disabled={busy}>
          {busy ? "..." : "Enregistrer & lancer"}
        </button>
        <button className="btn ghost" onClick={() => save(false)} disabled={busy}>
          Enregistrer seulement
        </button>
      </div>
    </div>
  );
}
