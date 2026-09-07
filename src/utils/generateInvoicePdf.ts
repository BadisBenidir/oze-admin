import type { jsPDF as JsPDFType } from 'jspdf';
import {
  COMPANY_LEGAL_NAME,
  COMPANY_SIRET,
  COMPANY_RCS,
  COMPANY_ADDRESS,
  COMPANY_VAT_NUMBER,
} from '../config/legal';

export interface InvoiceLineItem {
  description: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

export interface InvoiceBillingDetails {
  name?: string | null;
  entity_name?: string | null;
  legal_form?: string | null;
  siret?: string | null;
  vat_number?: string | null;
  address?: string | null;
  city?: string | null;
  postal_code?: string | null;
  country?: string | null;
}

export interface InvoiceData {
  invoiceNumber: string;
  issuedAt: string;
  orderNumber: string;
  orderDate: string;
  totalAmount: number;
  legalStatus: 'individual' | 'sole_proprietorship' | 'company';
  billingDetails: InvoiceBillingDetails;
  paymentMethod: string;
  items: InvoiceLineItem[];
}

const EUR = (n: number) => (Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const dateStr = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });

/**
 * Dessine UNE facture sur la page courante de `doc` (dessin natif jsPDF :
 * texte sélectionnable, pas un rendu html2canvas rasterisé, inadapté à un
 * document légal). Ne crée ni ne sauvegarde le document — permet de dessiner
 * plusieurs factures à la suite sur des pages successives d'un même PDF
 * (voir generateInvoicesBulkPdf, "Export groupé des factures du mois").
 *
 * OZË Paris est en franchise en base de TVA (art. 293 B du CGI, voir
 * config/legal.ts et Terms.tsx) : la mention légale reflète ce régime,
 * jamais une TVA sur marge (art. 297 A) qui ne s'applique pas ici.
 */
const drawInvoicePage = (doc: JsPDFType, data: InvoiceData): void => {
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 18;
  let y = 20;

  // En-tête émetteur
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(COMPANY_LEGAL_NAME, marginX, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  y += 6;
  doc.text(COMPANY_ADDRESS, marginX, y);
  y += 4.5;
  doc.text(`SIRET ${COMPANY_SIRET} — ${COMPANY_RCS}`, marginX, y);
  y += 4.5;
  doc.text(`TVA intracommunautaire : ${COMPANY_VAT_NUMBER}`, marginX, y);

  // Titre facture + références, aligné à droite
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('FACTURE', pageWidth - marginX, 20, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`N° ${data.invoiceNumber}`, pageWidth - marginX, 27, { align: 'right' });
  doc.text(`Date d'émission : ${dateStr(data.issuedAt)}`, pageWidth - marginX, 32, { align: 'right' });
  doc.text(`Commande : ${data.orderNumber} (${dateStr(data.orderDate)})`, pageWidth - marginX, 37, { align: 'right' });

  y = 48;
  doc.setDrawColor(200);
  doc.line(marginX, y, pageWidth - marginX, y);
  y += 8;

  // Bloc client — présentation dépend du statut juridique déclaré.
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('Facturé à', marginX, y);
  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);

  const b = data.billingDetails;
  const clientLines: string[] = [];
  if (data.legalStatus === 'individual') {
    if (b.name) clientLines.push(b.name);
  } else {
    if (b.entity_name) clientLines.push(b.legal_form ? `${b.entity_name} (${b.legal_form})` : b.entity_name);
    if (b.siret) clientLines.push(`SIRET : ${b.siret}`);
    if (b.vat_number) clientLines.push(`N° TVA intracommunautaire : ${b.vat_number}`);
  }
  if (b.address) clientLines.push(b.address);
  if (b.city || b.postal_code) clientLines.push(`${b.postal_code || ''} ${b.city || ''}`.trim());
  if (b.country) clientLines.push(b.country);

  clientLines.forEach((line) => {
    doc.text(line, marginX, y);
    y += 4.5;
  });

  y += 6;

  // Tableau des lignes — dessin manuel (pas de plugin autotable installé).
  const col = { desc: marginX, qty: pageWidth - 70, unit: pageWidth - 50, total: pageWidth - marginX };
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('Article', col.desc, y);
  doc.text('Qté', col.qty, y, { align: 'right' });
  doc.text('Prix unitaire', col.unit, y, { align: 'right' });
  doc.text('Total', col.total, y, { align: 'right' });
  y += 2;
  doc.setDrawColor(0);
  doc.line(marginX, y, pageWidth - marginX, y);
  y += 5;

  doc.setFont('helvetica', 'normal');
  data.items.forEach((item) => {
    const wrapped = doc.splitTextToSize(item.description, col.qty - marginX - 5);
    doc.text(wrapped, col.desc, y);
    doc.text(String(item.quantity), col.qty, y, { align: 'right' });
    doc.text(EUR(item.unitPrice), col.unit, y, { align: 'right' });
    doc.text(EUR(item.lineTotal), col.total, y, { align: 'right' });
    y += 4.5 * wrapped.length + 1.5;
  });

  y += 3;
  doc.line(marginX, y, pageWidth - marginX, y);
  y += 7;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(`Total TTC : ${EUR(data.totalAmount)}`, pageWidth - marginX, y, { align: 'right' });
  y += 8;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Mode de règlement : ${data.paymentMethod} — payé comptant.`, marginX, y);
  y += 10;

  // Mention légale de TVA — franchise en base (art. 293 B), jamais un
  // régime de marge qui ne s'applique pas à OZË Paris actuellement.
  doc.setFontSize(8);
  doc.setTextColor(90);
  const vatMention = doc.splitTextToSize(
    'TVA non applicable, article 293 B du Code Général des Impôts (franchise en base de TVA).',
    pageWidth - marginX * 2
  );
  doc.text(vatMention, marginX, y);
};

/** Génère et télécharge le PDF d'UNE facture — jsPDF chargé en dynamique
 * pour ne pas alourdir le bundle principal (déjà une dépendance de ce repo,
 * voir ProductLabel.tsx). */
export const generateInvoicePdf = async (data: InvoiceData): Promise<void> => {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  drawInvoicePage(doc, data);
  doc.save(`${data.invoiceNumber}.pdf`);
};

/**
 * "Export groupé des factures du mois" — un unique PDF multi-pages (une
 * facture par page), pas une archive ZIP : aucune bibliothèque de gestion de
 * ZIP (jszip ou équivalent) n'existe dans ce repo, et le résultat (un seul
 * fichier téléchargeable, imprimable tel quel) rend le même service pour un
 * usage comptable sans ajouter de dépendance.
 */
export const generateInvoicesBulkPdf = async (invoices: InvoiceData[], filename: string): Promise<void> => {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  invoices.forEach((data, index) => {
    if (index > 0) doc.addPage();
    drawInvoicePage(doc, data);
  });
  doc.save(filename);
};
