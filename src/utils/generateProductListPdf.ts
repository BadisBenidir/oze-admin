import type { jsPDF as JsPDFType } from 'jspdf';
import { COMPANY_ADDRESS, COMPANY_LEGAL_NAME, COMPANY_SIRET } from '../config/legal';

/**
 * PDF de la liste des articles (export de « Liste des Produits ») : A4
 * paysage, en-tête façon facture fournisseur (date, émetteur, période et
 * filtres), encadré de totaux, puis tableau numéroté dont l'en-tête est
 * répété sur chaque page. jsPDF chargé en dynamique (comme generateInvoicePdf).
 */

export interface ProductListPdfRow {
  date: string;
  supplierRef: string;
  platform: string;
  brand: string;
  title: string;
  condition: string;
  status: string;
  purchasePrice: number | null;
  salePrice: number | null;
  /** Prix réellement encaissé (vendu), null si pas vendu. */
  soldPrice: number | null;
  /** Prix vendu = prix revendeur d'une mission de sourcing sur mesure : affiché en orange. */
  soldViaSourcing: boolean;
}

export interface ProductListPdfData {
  rows: ProductListPdfRow[];
  periodLabel: string;
  filtersLabel: string;
  fileName: string;
}

const PAGE_W = 297;
const PAGE_H = 210;
const MARGIN = 10;
const HEADER_FILL: [number, number, number] = [31, 41, 55];
/** Prix vendu des pièces de sourcing sur mesure (prix revendeur de la mission). */
const SOURCING_COLOR: [number, number, number] = [217, 119, 6];

const COLUMNS: { label: string; width: number; align?: 'right' | 'center' }[] = [
  { label: 'N°', width: 10, align: 'center' },
  { label: 'Date', width: 18, align: 'center' },
  { label: 'Réf. fournisseur', width: 26 },
  { label: 'Plateforme', width: 18 },
  { label: 'Marque', width: 24 },
  { label: 'Titre', width: 65 },
  { label: 'État', width: 16, align: 'center' },
  { label: 'Statut', width: 28 },
  { label: "Prix d'achat", width: 24, align: 'right' },
  { label: 'Prix de vente', width: 24, align: 'right' },
  { label: 'Prix vendu', width: 24, align: 'right' },
];

/** Montant « 1 234,50 € » sans les espaces insécables que jsPDF n'affiche pas. */
const eur = (n: number) =>
  n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/\s/g, ' ') + ' €';

/** Coupe un texte trop long pour sa cellule, avec « … ». */
const fit = (doc: JsPDFType, text: string, width: number) => {
  if (doc.getTextWidth(text) <= width) return text;
  let t = text;
  while (t.length > 1 && doc.getTextWidth(`${t}…`) > width) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
};

const drawTableHeader = (doc: JsPDFType, y: number) => {
  doc.setFillColor(...HEADER_FILL);
  doc.rect(MARGIN, y, PAGE_W - 2 * MARGIN, 6, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(255);
  let x = MARGIN;
  for (const col of COLUMNS) {
    doc.text(col.label, x + col.width / 2, y + 4, { align: 'center' });
    x += col.width;
  }
  doc.setTextColor(0);
  return y + 6;
};

export const generateProductListPdf = async (data: ProductListPdfData): Promise<void> => {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  const today = new Date().toLocaleDateString('fr-FR');

  // ── En-tête ──
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(today, PAGE_W - MARGIN, 14, { align: 'right' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('LISTE DES ARTICLES', PAGE_W / 2, 20, { align: 'center' });
  const titleW = doc.getTextWidth('LISTE DES ARTICLES');
  doc.setLineWidth(0.4);
  doc.line(PAGE_W / 2 - titleW / 2, 21.5, PAGE_W / 2 + titleW / 2, 21.5);

  doc.setFontSize(10);
  doc.text('OZË PARIS', MARGIN, 30);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(`${COMPANY_LEGAL_NAME} — ${COMPANY_ADDRESS}`, MARGIN, 34.5);
  doc.text(`SIRET ${COMPANY_SIRET}`, MARGIN, 38.5);

  doc.setFont('helvetica', 'bold');
  doc.text('Période :', PAGE_W - MARGIN - 90, 30);
  doc.text('Filtres :', PAGE_W - MARGIN - 90, 34.5);
  doc.setFont('helvetica', 'normal');
  doc.text(data.periodLabel, PAGE_W - MARGIN - 75, 30);
  doc.text(doc.splitTextToSize(data.filtersLabel, 75).slice(0, 2), PAGE_W - MARGIN - 75, 34.5);

  // ── Encadré des totaux ──
  const totalPurchase = data.rows.reduce((s, r) => s + (r.purchasePrice ?? 0), 0);
  const totalSale = data.rows.reduce((s, r) => s + (r.salePrice ?? 0), 0);
  // Total vendu hors sourcing, puis avec les pièces de sourcing sur mesure.
  const totalSoldOrders = data.rows.reduce((s, r) => s + (!r.soldViaSourcing ? r.soldPrice ?? 0 : 0), 0);
  const totalSold = data.rows.reduce((s, r) => s + (r.soldPrice ?? 0), 0);
  const boxes: { label: string; value: string; second?: string }[] = [
    { label: "Nombre d'articles", value: String(data.rows.length) },
    { label: "Total prix d'achat", value: eur(totalPurchase) },
    { label: 'Total prix de vente', value: eur(totalSale) },
    { label: 'Total vendu', value: eur(totalSoldOrders), second: `avec sourcing : ${eur(totalSold)}` },
    { label: 'Marge totale', value: eur(totalSale - totalPurchase) },
  ];
  const boxW = 42;
  let bx = PAGE_W - MARGIN - boxW * boxes.length;
  const by = 44;
  for (const box of boxes) {
    doc.setFillColor(...HEADER_FILL);
    doc.rect(bx, by, boxW, 5, 'F');
    doc.setDrawColor(...HEADER_FILL);
    doc.setLineWidth(0.3);
    doc.rect(bx, by, boxW, 15);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(255);
    doc.text(box.label, bx + boxW / 2, by + 3.5, { align: 'center' });
    doc.setTextColor(0);
    doc.setFontSize(10);
    doc.text(box.value, bx + boxW - 2, by + 10.2, { align: 'right' });
    if (box.second) {
      doc.setFontSize(7);
      doc.setTextColor(...SOURCING_COLOR);
      doc.text(box.second, bx + boxW - 2, by + 13.6, { align: 'right' });
      doc.setTextColor(0);
    }
    bx += boxW;
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(110);
  doc.text('Montants en euros', MARGIN, by + 10);
  doc.setTextColor(...SOURCING_COLOR);
  doc.text('En orange : prix vendu des pièces de sourcing sur mesure (prix revendeur de la mission)', MARGIN, by + 14);
  doc.setTextColor(0);

  // ── Tableau ──
  const ROW_H = 5;
  let y = drawTableHeader(doc, 63);
  doc.setDrawColor(190);
  doc.setLineWidth(0.15);

  data.rows.forEach((row, i) => {
    if (y + ROW_H > PAGE_H - 14) {
      doc.addPage();
      y = drawTableHeader(doc, 14);
      doc.setDrawColor(190);
      doc.setLineWidth(0.15);
    }
    if (i % 2 === 1) {
      doc.setFillColor(246, 247, 249);
      doc.rect(MARGIN, y, PAGE_W - 2 * MARGIN, ROW_H, 'F');
    }
    const cells = [
      String(i + 1),
      row.date,
      row.supplierRef,
      row.platform,
      row.brand,
      row.title,
      row.condition,
      row.status,
      row.purchasePrice != null ? eur(row.purchasePrice) : '—',
      row.salePrice != null ? eur(row.salePrice) : '—',
      row.soldPrice != null ? eur(row.soldPrice) : '—',
    ];
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    let x = MARGIN;
    COLUMNS.forEach((col, c) => {
      const text = fit(doc, cells[c], col.width - 2.4);
      const orange = col.label === 'Prix vendu' && row.soldViaSourcing && row.soldPrice != null;
      if (orange) {
        doc.setTextColor(...SOURCING_COLOR);
        doc.setFont('helvetica', 'bold');
      }
      const tx = col.align === 'right' ? x + col.width - 1.2 : col.align === 'center' ? x + col.width / 2 : x + 1.2;
      doc.text(text, tx, y + 3.5, { align: col.align === 'right' ? 'right' : col.align === 'center' ? 'center' : 'left' });
      if (orange) {
        doc.setTextColor(0);
        doc.setFont('helvetica', 'normal');
      }
      doc.line(x, y, x, y + ROW_H);
      x += col.width;
    });
    doc.line(x, y, x, y + ROW_H);
    doc.line(MARGIN, y + ROW_H, PAGE_W - MARGIN, y + ROW_H);
    y += ROW_H;
  });

  if (data.rows.length === 0) {
    doc.setFontSize(9);
    doc.text('Aucun article pour ces critères.', PAGE_W / 2, y + 8, { align: 'center' });
  }

  // ── Numéros de page ──
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(`${p} / ${pages}`, PAGE_W / 2, PAGE_H - 6, { align: 'center' });
    doc.setTextColor(0);
  }

  doc.save(data.fileName);
};
