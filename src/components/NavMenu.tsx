"use client";
import { useEffect, useRef, useState } from "react";

export type NavLink = { href: string; label: string; badge?: boolean };

/**
 * Navigation de la topbar : liens inline sur desktop, menu déroulant (☰) sur
 * mobile pour ne pas empiler toutes les sections.
 */
export default function NavMenu({ links }: { links: NavLink[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, [open]);

  const anyBadge = links.some((l) => l.badge);

  return (
    <div className="nav-menu" ref={ref}>
      <div className="nav-inline">
        {links.map((l) => (
          <a key={l.href + l.label} className="btn ghost" href={l.href} style={{ position: "relative" }}>
            {l.label}
            {l.badge && <span className="nav-dot" />}
          </a>
        ))}
      </div>

      <button type="button" className="btn ghost nav-toggle" onClick={() => setOpen((o) => !o)} aria-label="Menu" style={{ position: "relative" }}>
        ☰{anyBadge && <span className="nav-dot" />}
      </button>

      {open && (
        <div className="nav-dropdown">
          {links.map((l) => (
            <a key={l.href + l.label} href={l.href} onClick={() => setOpen(false)}>
              {l.label}
              {l.badge && <span className="nav-dot" style={{ position: "static", marginLeft: 8 }} />}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
