"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import ZonePicker from "./ZonePicker";

const CPE = ["A", "B", "C", "D", "E", "F", "G", "H", "I"];

export default function NewSearch() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [propertyType, setPropertyType] = useState("apartment");
  // Défaut : tout Luxembourg-Ville activé via le toggle
  const [locCodes, setLocCodes] = useState<string[]>(["L9-luxembourg"]);
  const [surfaceMin, setSurfaceMin] = useState("");
  const [surfaceMax, setSurfaceMax] = useState("50");
  const [priceMin, setPriceMin] = useState("");
  const [priceMax, setPriceMax] = useState("");
  const [cpe, setCpe] = useState<string[]>(["F", "G", "H", "I"]);
  const [keywords, setKeywords] = useState("a renover, travaux, rafraichir");

  // scoring
  const [resaleEurPerM2, setResale] = useState("11000");
  const [worksEurPerM2, setWorks] = useState("1500");
  const [notaryPct, setNotary] = useState("7");
  const [resaleAgencyPct, setAgency] = useState("3");
  const [targetMarginPct, setMargin] = useState("20");

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
        surfaceMin: num(surfaceMin),
        surfaceMax: num(surfaceMax),
        priceMin: num(priceMin),
        priceMax: num(priceMax),
        cpeClasses: cpe,
        keywords: keywords.split(",").map((s) => s.trim()).filter(Boolean),
      },
      scoring: {
        resaleEurPerM2: Number(resaleEurPerM2),
        worksEurPerM2: Number(worksEurPerM2),
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
        <div className="brand">
          <span className="dot" />
          <h1>Nouvelle recherche</h1>
        </div>
        <a className="btn ghost" href="/">← Retour</a>
      </div>

      <div className="card">
        <label>Nom de la recherche</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex : F+ < 50m² Luxembourg-ville" />

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
          <label>Classes énergétiques à retenir</label>
          <div className="chips">
            {CPE.map((c) => (
              <span key={c} className={`chip ${cpe.includes(c) ? "on" : ""}`} onClick={() => toggleCpe(c)}>{c}</span>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <label>Mots-clés "travaux" (séparés par virgule)</label>
          <input type="text" value={keywords} onChange={(e) => setKeywords(e.target.value)} />
        </div>
      </div>

      <div className="section-title">
        <h2>Paramètres de scoring</h2>
        <span className="rule" />
      </div>
      <div className="card">
        <div className="row">
          <div><label>Revente cible (€/m²)</label><input type="number" value={resaleEurPerM2} onChange={(e) => setResale(e.target.value)} /></div>
          <div><label>Travaux (€/m²)</label><input type="number" value={worksEurPerM2} onChange={(e) => setWorks(e.target.value)} /></div>
        </div>
        <div className="row" style={{ marginTop: 16 }}>
          <div><label>Frais acquisition (%)</label><input type="number" value={notaryPct} onChange={(e) => setNotary(e.target.value)} /></div>
          <div><label>Frais revente (%)</label><input type="number" value={resaleAgencyPct} onChange={(e) => setAgency(e.target.value)} /></div>
          <div><label>Marge nette cible (%)</label><input type="number" value={targetMarginPct} onChange={(e) => setMargin(e.target.value)} /></div>
        </div>
        <p className="muted" style={{ fontSize: "0.82rem", marginBottom: 0 }}>
          Le verdict GO / NÉGOCIER / PASS et le prix d'achat max sont recalculés à chaque run à partir de ces valeurs.
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
