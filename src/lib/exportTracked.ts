// S11 — Export du suivi (vue courante / playlist).
//  - Excel (.xlsx) : tous les chiffres + lien Google Maps (sans photos).
//  - PDF : une fiche par bien (2 photos, tous les chiffres, screenshot de la
//    carte, lien Google Maps + lien annonce).
// Génération côté navigateur (imports dynamiques). Photos et tuiles passent par
// /api/imgproxy (même origine) pour contourner CORS.

export type ExportBien = {
  bien: string;
  commune: string;
  adresse: string;
  statut: string;
  url: string;
  gmaps: string;
  price: number;
  surface: number | string;
  cpe: string;
  resalePerM2?: number | null;
  resaleValue?: number | null;
  worksCost?: number | null;
  acquisitionCost?: number | null;
  resaleCost?: number | null;
  totalInvested?: number | null;
  netProfit?: number | null;
  marginPct?: number | null;
  maxBuyPrice?: number | null;
  worksVatPct?: number | null;
  notaryPct?: number | null;
  resaleAgencyPct?: number | null;
  targetMarginPct?: number | null;
  lat?: number | null;
  lng?: number | null;
  photos?: string[];
};

const eur = (n?: number | null) =>
  n == null ? "—" : Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".") + " €";
const pct = (v?: number | null) => (v == null ? null : `${Math.round(v * 1000) / 10} %`);
const safeName = (s: string) => s.replace(/[^\p{L}\p{N}_-]+/gu, "_").replace(/^_+|_+$/g, "") || "suivis";
const proxied = (url: string) => `/api/imgproxy?url=${encodeURIComponent(url)}`;

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = src;
  });
}

// Screenshot de carte : assemblage de tuiles OSM (via proxy) sur un canvas.
async function renderMapDataUrl(lat: number, lng: number): Promise<string | null> {
  try {
    const z = 15, TS = 256, W = 480, H = 300;
    const n = 2 ** z;
    const xt = ((lng + 180) / 360) * n;
    const latRad = (lat * Math.PI) / 180;
    const yt = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
    const cx = xt * TS, cy = yt * TS;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#e8eef0";
    ctx.fillRect(0, 0, W, H);
    const tx0 = Math.floor(xt), ty0 = Math.floor(yt);
    const tasks: Promise<void>[] = [];
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        const tx = tx0 + dx, ty = ty0 + dy;
        if (tx < 0 || ty < 0 || tx >= n || ty >= n) continue;
        const px = tx * TS - cx + W / 2;
        const py = ty * TS - cy + H / 2;
        if (px > W || py > H || px + TS < 0 || py + TS < 0) continue;
        const src = proxied(`https://a.tile.openstreetmap.org/${z}/${tx}/${ty}.png`);
        tasks.push(loadImage(src).then((img) => { if (img) ctx.drawImage(img, px, py, TS, TS); }));
      }
    }
    await Promise.all(tasks);
    // marqueur au centre
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, 7, 0, 2 * Math.PI);
    ctx.fillStyle = "#c0392b";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
    return canvas.toDataURL("image/jpeg", 0.82);
  } catch {
    return null;
  }
}

// ---- Excel ----------------------------------------------------------------

export async function exportExcel(biens: ExportBien[], baseName: string) {
  const XLSX = await import("xlsx");
  const data = biens.map((b) => ({
    "Bien": b.bien,
    "Commune": b.commune,
    "Adresse": b.adresse,
    "Statut": b.statut,
    "Prix (€)": b.price,
    "m²": b.surface,
    "CPE": b.cpe,
    "Revente €/m²": b.resalePerM2 ?? "",
    "Revente estimée (€)": b.resaleValue ?? "",
    "Travaux TTC (€)": b.worksCost ?? "",
    "TVA travaux": pct(b.worksVatPct) ?? "",
    "Frais acquisition (€)": b.acquisitionCost ?? "",
    "Frais acq. %": pct(b.notaryPct) ?? "",
    "Frais revente (€)": b.resaleCost ?? "",
    "Frais revente %": pct(b.resaleAgencyPct) ?? "",
    "Capital investi (€)": b.totalInvested ?? "",
    "Bénéfice brut (€)": b.netProfit ?? "",
    "Marge (%)": b.marginPct ?? "",
    "Prix d'achat max (€)": b.maxBuyPrice ?? "",
    "Google Maps": b.gmaps,
    "Annonce": b.url,
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  ws["!cols"] = Object.keys(data[0] || {}).map((k) =>
    k === "Bien" || k === "Adresse" || k === "Google Maps" || k === "Annonce" ? { wch: 34 } : { wch: 14 }
  );
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Suivis");
  XLSX.writeFile(wb, `${safeName(baseName)}.xlsx`);
}

// ---- PDF ------------------------------------------------------------------

const GREEN: [number, number, number] = [12, 189, 142];
const LINK: [number, number, number] = [7, 135, 95];

export async function exportPdf(biens: ExportBien[], title: string, baseName: string) {
  const { default: jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  for (let i = 0; i < biens.length; i++) {
    const b = biens[i];
    if (i > 0) doc.addPage();
    let y = 16;

    doc.setFontSize(14);
    doc.setTextColor(20);
    doc.text(doc.splitTextToSize(b.bien, 182)[0], 14, y);
    y += 6;
    doc.setFontSize(10);
    doc.setTextColor(110);
    const sub = [b.commune, b.adresse, b.statut].filter(Boolean).join("  ·  ");
    doc.text(doc.splitTextToSize(sub, 182)[0], 14, y);
    y += 6;

    // Photos (2 max)
    const [p0, p1] = await Promise.all([
      b.photos?.[0] ? loadImage(proxied(b.photos[0])) : Promise.resolve(null),
      b.photos?.[1] ? loadImage(proxied(b.photos[1])) : Promise.resolve(null),
    ]);
    const pw = 90, ph = 60;
    let drew = false;
    [p0, p1].forEach((img, idx) => {
      if (img) {
        try { doc.addImage(img, "JPEG", 14 + idx * (pw + 6), y, pw, ph); drew = true; } catch {}
      }
    });
    if (drew) y += ph + 6;

    // Chiffres (table 2 colonnes label / valeur)
    const rows: [string, string][] = [
      ["Prix affiché", eur(b.price)],
      ["Surface", `${b.surface} m²`],
      ["CPE", b.cpe || "—"],
      ["Revente estimée", `${eur(b.resaleValue)}${b.resalePerM2 != null ? `  (${eur(b.resalePerM2)}/m²)` : ""}`],
      [`Travaux TTC${pct(b.worksVatPct) ? ` (TVA ${pct(b.worksVatPct)})` : ""}`, eur(b.worksCost)],
      [`Frais acquisition${pct(b.notaryPct) ? ` (${pct(b.notaryPct)})` : ""}`, eur(b.acquisitionCost)],
      [`Frais revente${pct(b.resaleAgencyPct) ? ` (${pct(b.resaleAgencyPct)})` : ""}`, eur(b.resaleCost)],
      ["Capital investi", eur(b.totalInvested)],
      ["Bénéfice brut", eur(b.netProfit)],
      ["Marge brute", b.marginPct != null ? `${b.marginPct} %` : "—"],
      [`Prix d'achat max${pct(b.targetMarginPct) ? ` (cible ${pct(b.targetMarginPct)})` : ""}`, eur(b.maxBuyPrice)],
    ];
    autoTable(doc, {
      startY: y,
      body: rows,
      theme: "plain",
      styles: { fontSize: 9.5, cellPadding: 1.4 },
      columnStyles: { 0: { textColor: [110, 114, 112], cellWidth: 90 }, 1: { halign: "right", fontStyle: "bold" } },
      margin: { left: 14, right: 14 },
    });
    y = (doc as any).lastAutoTable.finalY + 6;

    // Carte + liens
    const mapData = b.lat != null && b.lng != null ? await renderMapDataUrl(b.lat, b.lng) : null;
    if (mapData) {
      try { doc.addImage(mapData, "JPEG", 14, y, 96, 60); } catch {}
    }
    const linkX = mapData ? 116 : 14;
    let linkY = mapData ? y + 10 : y;
    doc.setFontSize(10);
    doc.setTextColor(...LINK);
    if (b.gmaps) { doc.textWithLink("Ouvrir dans Google Maps", linkX, linkY, { url: b.gmaps }); linkY += 8; }
    if (b.url) { doc.textWithLink("Voir l'annonce atHome", linkX, linkY, { url: b.url }); }
  }

  doc.save(`${safeName(baseName)}.pdf`);
}
