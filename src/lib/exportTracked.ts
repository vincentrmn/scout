// S11 — Export du tableau de suivi (vue courante / playlist) en Excel et PDF.
// Génération 100% côté navigateur (imports dynamiques pour ne pas alourdir le
// bundle initial).

export type ExportRow = {
  bien: string;
  commune: string;
  adresse: string;
  prix: number;
  surface: number | string;
  cpe: string;
  marge: string;
  statut: string;
  url: string;
};

const COLS: { key: keyof ExportRow; header: string }[] = [
  { key: "bien", header: "Bien" },
  { key: "commune", header: "Commune" },
  { key: "adresse", header: "Adresse" },
  { key: "prix", header: "Prix (€)" },
  { key: "surface", header: "m²" },
  { key: "cpe", header: "CPE" },
  { key: "marge", header: "Marge" },
  { key: "statut", header: "Statut" },
  { key: "url", header: "Lien" },
];

const safeName = (s: string) => s.replace(/[^\p{L}\p{N}_-]+/gu, "_").replace(/^_+|_+$/g, "") || "suivis";

export async function exportExcel(rows: ExportRow[], baseName: string) {
  const XLSX = await import("xlsx");
  const data = rows.map((r) => {
    const o: Record<string, any> = {};
    for (const c of COLS) o[c.header] = r[c.key];
    return o;
  });
  const ws = XLSX.utils.json_to_sheet(data, { header: COLS.map((c) => c.header) });
  ws["!cols"] = [{ wch: 34 }, { wch: 22 }, { wch: 28 }, { wch: 12 }, { wch: 6 }, { wch: 5 }, { wch: 8 }, { wch: 14 }, { wch: 40 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Suivis");
  XLSX.writeFile(wb, `${safeName(baseName)}.xlsx`);
}

const eur = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".") + " €";

export async function exportPdf(rows: ExportRow[], title: string, baseName: string) {
  const { default: jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const doc = new jsPDF({ orientation: "landscape" });
  doc.setFontSize(13);
  doc.text(title, 14, 15);
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(`${rows.length} bien${rows.length > 1 ? "s" : ""} · ${new Date().toLocaleDateString("fr-FR")}`, 14, 21);
  autoTable(doc, {
    startY: 26,
    head: [COLS.map((c) => c.header)],
    body: rows.map((r) => COLS.map((c) => (c.key === "prix" ? eur(r.prix) : String(r[c.key] ?? "")))),
    styles: { fontSize: 7.5, cellPadding: 2, overflow: "linebreak" },
    headStyles: { fillColor: [12, 189, 142] },
    columnStyles: { 8: { cellWidth: 60 } },
  });
  doc.save(`${safeName(baseName)}.pdf`);
}
