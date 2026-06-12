"use client";
import { useState } from "react";
import { EMPTY_RULES, type PlaylistRules } from "@/lib/playlist";

/**
 * S11 — Création / édition d'une playlist : nom + règles d'auto-remplissage
 * (CPE / quartier / recherche sauvegardée, combinées en ET ou OU).
 */

function Chips({
  options,
  selected,
  onToggle,
}: {
  options: { value: string; label: string }[];
  selected: string[];
  onToggle: (v: string) => void;
}) {
  if (options.length === 0) return <span className="muted" style={{ fontSize: "0.8rem" }}>—</span>;
  return (
    <div className="chips">
      {options.map((o) => (
        <button key={o.value} type="button" className={`chip ${selected.includes(o.value) ? "on" : ""}`} onClick={() => onToggle(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div className="muted" style={{ fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

export default function PlaylistEditor({
  initialName = "",
  initialRules = EMPTY_RULES,
  cpeOptions,
  communeOptions,
  configs,
  onSave,
  onCancel,
  busy,
}: {
  initialName?: string;
  initialRules?: PlaylistRules;
  cpeOptions: string[];
  communeOptions: string[];
  configs: { id: number; name: string }[];
  onSave: (name: string, rules: PlaylistRules) => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  const [name, setName] = useState(initialName);
  const [rules, setRules] = useState<PlaylistRules>(initialRules);

  const toggleStr = (key: "cpe" | "communes", v: string) => {
    const cur = rules[key];
    setRules({ ...rules, [key]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] });
  };
  const toggleConfig = (id: number) => {
    const cur = rules.configIds;
    setRules({ ...rules, configIds: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
  };

  return (
    <div className="card" style={{ marginBottom: 14, padding: "16px 18px" }}>
      <div style={{ marginBottom: 14 }}>
        <label>Nom de la playlist</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex. CPE A-B Limpertsberg" />
      </div>

      <Group title="CPE">
        <Chips options={cpeOptions.map((c) => ({ value: c, label: c }))} selected={rules.cpe} onToggle={(v) => toggleStr("cpe", v)} />
      </Group>
      <Group title="Quartier">
        <Chips options={communeOptions.map((c) => ({ value: c, label: c }))} selected={rules.communes} onToggle={(v) => toggleStr("communes", v)} />
      </Group>
      <Group title="Recherche sauvegardée (par critères)">
        {configs.length === 0 ? (
          <span className="muted" style={{ fontSize: "0.8rem" }}>Aucune recherche sauvegardée.</span>
        ) : (
          <div className="chips">
            {configs.map((cf) => (
              <button key={cf.id} type="button" className={`chip ${rules.configIds.includes(cf.id) ? "on" : ""}`} onClick={() => toggleConfig(cf.id)}>
                {cf.name}
              </button>
            ))}
          </div>
        )}
      </Group>

      <Group title="Combinaison des critères">
        <div className="chips">
          <button type="button" className={`chip ${rules.match === "all" ? "on" : ""}`} onClick={() => setRules({ ...rules, match: "all" })}>
            ET (tous)
          </button>
          <button type="button" className={`chip ${rules.match === "any" ? "on" : ""}`} onClick={() => setRules({ ...rules, match: "any" })}>
            OU (au moins un)
          </button>
        </div>
      </Group>

      <p className="muted" style={{ fontSize: "0.78rem", fontStyle: "italic", margin: "0 0 12px" }}>
        Les biens suivis qui matchent entrent automatiquement. Tu pourras aussi ajouter/retirer des biens à la main.
      </p>

      <div className="row" style={{ gap: 8 }}>
        <button className="btn green" disabled={busy || !name.trim()} onClick={() => onSave(name.trim(), rules)} style={{ flex: "0 0 auto" }}>
          Enregistrer
        </button>
        <button className="btn ghost" disabled={busy} onClick={onCancel} style={{ flex: "0 0 auto" }}>
          Annuler
        </button>
      </div>
    </div>
  );
}
