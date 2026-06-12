// Petites icônes d'export (Excel vert, PDF rouge) — SVG inline.

export function ExcelIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="3" fill="#1d7044" />
      <path d="M7.5 8l3 4-3 4h2l2-2.8L13.5 16h2l-3-4 3-4h-2l-2 2.8L9.5 8z" fill="#fff" />
    </svg>
  );
}

export function PdfIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="3" fill="#d5252b" />
      <text x="12" y="16" textAnchor="middle" fontSize="7.5" fontWeight="700" fill="#fff" fontFamily="Arial, sans-serif">PDF</text>
    </svg>
  );
}
