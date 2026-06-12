"use client";
import { useCallback, useEffect, useState } from "react";

/**
 * Bande de photos + lightbox plein écran (partagée Résultats + Suivis).
 * Clic sur une vignette → overlay sombre dans la page (flèches ‹ ›, fermeture clic/Échap).
 */
export default function PhotoStrip({ photos }: { photos?: string[] }) {
  // Index de la photo affichée en plein écran, null = lightbox fermée.
  const [active, setActive] = useState<number | null>(null);

  const close = useCallback(() => setActive(null), []);
  const go = useCallback(
    (dir: number) =>
      setActive((i) => {
        if (i === null || !photos || photos.length === 0) return i;
        return (i + dir + photos.length) % photos.length;
      }),
    [photos]
  );

  // Navigation clavier + blocage du scroll de fond tant que la lightbox est ouverte.
  useEffect(() => {
    if (active === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [active, close, go]);

  if (!photos || photos.length === 0) return null;

  return (
    <>
      <div className="photo-strip">
        {photos.map((src, i) => (
          <button
            key={i}
            type="button"
            className="photo-thumb"
            onClick={() => setActive(i)}
            title="Agrandir la photo"
          >
            <img
              src={src}
              alt={`Photo ${i + 1}`}
              loading="lazy"
              onError={(e) => {
                (e.currentTarget.parentElement as HTMLElement).style.display = "none";
              }}
            />
          </button>
        ))}
      </div>

      {active !== null && (
        <div className="lightbox" onClick={close} role="dialog" aria-modal="true">
          <button className="lightbox-close" onClick={close} aria-label="Fermer">×</button>
          {photos.length > 1 && (
            <button
              className="lightbox-nav prev"
              onClick={(e) => { e.stopPropagation(); go(-1); }}
              aria-label="Photo précédente"
            >
              ‹
            </button>
          )}
          <img
            className="lightbox-img"
            src={photos[active]}
            alt={`Photo ${active + 1}`}
            onClick={(e) => e.stopPropagation()}
          />
          {photos.length > 1 && (
            <button
              className="lightbox-nav next"
              onClick={(e) => { e.stopPropagation(); go(1); }}
              aria-label="Photo suivante"
            >
              ›
            </button>
          )}
          {photos.length > 1 && (
            <div className="lightbox-counter">{active + 1} / {photos.length}</div>
          )}
        </div>
      )}
    </>
  );
}
