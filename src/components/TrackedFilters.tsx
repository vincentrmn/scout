"use client";
import type { TrackedFilter } from "@/lib/trackedFilter";

/**
 * S11 — Barre de filtres des Suivis (panneau dépliable).
 * Contrôlée : reçoit le filtre courant + les options et remonte les changements.
 */

type StatusOption = { key: string; label: string };

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
        <button
          key={o.value}
          type="button"
          className={`chip ${selected.includes(o.value) ? "on" : ""}`}
          onClick={() => onToggle(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div className="muted" style={{ fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

export default function TrackedFilters({
  filter,
  onChange,
  cpeOptions,
  communeOptions,
  statusOptions,
}: {
  filter: TrackedFilter;
  onChange: (f: TrackedFilter) => void;
  cpeOptions: string[];
  communeOptions: string[];
  statusOptions: StatusOption[];
}) {
  const toggle = (key: "cpe" | "communes" | "statuses", v: string) => {
    const cur = filter[key];
    onChange({ ...filter, [key]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] });
  };
  const num = (v: string): number | null => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  };

  return (
    <div className="card" style={{ marginBottom: 14, padding: "16px 18px" }}>
      <FilterGroup title="CPE">
        <Chips options={cpeOptions.map((c) => ({ value: c, label: c }))} selected={filter.cpe} onToggle={(v) => toggle("cpe", v)} />
      </FilterGroup>

      <FilterGroup title="Quartier">
        <Chips options={communeOptions.map((c) => ({ value: c, label: c }))} selected={filter.communes} onToggle={(v) => toggle("communes", v)} />
      </FilterGroup>

      <FilterGroup title="Statut">
        <Chips options={statusOptions.map((s) => ({ value: s.key, label: s.label }))} selected={filter.statuses} onToggle={(v) => toggle("statuses", v)} />
      </FilterGroup>

      <div className="row" style={{ alignItems: "flex-end" }}>
        <div>
          <label>Marge min (%)</label>
          <input type="number" value={filter.marginMin ?? ""} onChange={(e) => onChange({ ...filter, marginMin: num(e.target.value) })} placeholder="—" />
        </div>
        <div>
          <label>Prix min (€)</label>
          <input type="number" value={filter.priceMin ?? ""} onChange={(e) => onChange({ ...filter, priceMin: num(e.target.value) })} placeholder="—" />
        </div>
        <div>
          <label>Prix max (€)</label>
          <input type="number" value={filter.priceMax ?? ""} onChange={(e) => onChange({ ...filter, priceMax: num(e.target.value) })} placeholder="—" />
        </div>
        <div style={{ flex: 2 }}>
          <label>Recherche (titre, commune, adresse…)</label>
          <input type="text" value={filter.text} onChange={(e) => onChange({ ...filter, text: e.target.value })} placeholder="Mot-clé…" />
        </div>
      </div>
    </div>
  );
}
