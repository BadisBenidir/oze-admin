import type { jsPDF as JsPDFType } from 'jspdf';
import {
  COMPANY_LEGAL_NAME,
  COMPANY_SIRET,
  COMPANY_RCS,
  COMPANY_ADDRESS,
  COMPANY_VAT_NUMBER,
} from '../config/legal';
import { OZE_LOGO_BASE64, OZE_LOGO_ASPECT_RATIO } from '../assets/ozeLogoBase64';
import { importOrReload } from './reloadOnStaleChunk';

export interface InvoiceLineItem {
  description: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

export interface InvoiceSourceItem {
  product_snapshot?: { name?: string } | null;
  unit_price: number;
  quantity: number;
  line_total: number;
  status?: string | null;
  insured?: boolean | null;
  insurance_cost?: number | null;
  entrupy_requested?: boolean | null;
  entrupy_cost?: number | null;
}

/**
 * Lignes de facture d'une commande — source unique pour tous les écrans
 * (admin, portail revendeur, export groupé). L'assurance transport et le
 * certificat Entrupy sont inclus dans orders.total_amount (voir 0021 / 0083) :
 * sans lignes dédiées, ils étaient absorbés dans le reliquat "Livraison" et
 * rien n'indiquait sur la facture que l'article avait été assuré.
 */
export const buildInvoiceItems = (
  items: InvoiceSourceItem[],
  /** Pénalité de retard de paiement d'un lot d'enchère (0210), figée sur la commande. */
  lateFee?: { amount?: number | null; days?: number | null } | null
): InvoiceLineItem[] => [
  ...items
    .filter((i) => i.status !== 'cancelled')
    .flatMap((i) => {
      const name = i.product_snapshot?.name || 'Article';
      const lines: InvoiceLineItem[] = [
        { description: name, unitPrice: i.unit_price, quantity: i.quantity, lineTotal: i.line_total },
      ];
      const insurance = Number(i.insurance_cost) || 0;
      if (i.insured && insurance > 0) {
        lines.push({ description: `Assurance transport — ${name}`, unitPrice: insurance, quantity: 1, lineTotal: insurance });
      }
      const entrupy = Number(i.entrupy_cost) || 0;
      if (i.entrupy_requested && entrupy > 0) {
        lines.push({ description: `Certificat d'authenticité Entrupy — ${name}`, unitPrice: entrupy, quantity: 1, lineTotal: entrupy });
      }
      return lines;
    }),
  ...(Number(lateFee?.amount) > 0
    ? [{
        description: `Pénalité de retard de paiement (${lateFee!.days || 1} jour${(lateFee!.days || 1) > 1 ? 's' : ''} × 5 % du prix du lot)`,
        unitPrice: Number(lateFee!.amount),
        quantity: 1,
        lineTotal: Number(lateFee!.amount),
      }]
    : []),
];

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
  /** false : facture à régler (ex. facture d'avance de sourcing pas encore
   * payée) — sinon « Facture acquittée ». */
  paid?: boolean;
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

  // Logo en haut à gauche — image fournie par l'utilisateur (voir
  // src/assets/ozeLogoBase64.ts), largeur fixe et hauteur dérivée de son
  // ratio réel (670x601) pour ne jamais la déformer.
  const logoW = 30;
  const logoH = logoW / OZE_LOGO_ASPECT_RATIO;
  doc.addImage(OZE_LOGO_BASE64, 'PNG', marginX, 12, logoW, logoH);

  // Titre facture + références, aligné à droite — même hauteur que le logo.
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('FACTURE', pageWidth - marginX, 20, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(110);
  doc.text(`N° ${data.invoiceNumber}`, pageWidth - marginX, 27, { align: 'right' });
  doc.text(`Commande : ${data.orderNumber}`, pageWidth - marginX, 32, { align: 'right' });
  doc.text(`Date : ${dateStr(data.orderDate)}`, pageWidth - marginX, 37, { align: 'right' });
  doc.setTextColor(0);

  let y = 12 + logoH + 16;

  // Deux colonnes ÉMETTEUR / FACTURÉ À, cote à cote.
  const colRight = pageWidth / 2 + 8;
  const labelY = y;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(140);
  doc.text('ÉMETTEUR', marginX, labelY);
  doc.text('FACTURÉ À', colRight, labelY);
  doc.setTextColor(0);

  const emitterLines = [
    COMPANY_LEGAL_NAME,
    COMPANY_ADDRESS,
    `SIRET : ${COMPANY_SIRET}`,
    `TVA : ${COMPANY_VAT_NUMBER}`,
    COMPANY_RCS,
  ];

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

  const drawBlock = (lines: string[], x: number, boldFirst: boolean) => {
    let blockY = labelY + 6;
    doc.setFontSize(9.5);
    lines.forEach((line, i) => {
      doc.setFont('helvetica', boldFirst && i === 0 ? 'bold' : 'normal');
      doc.text(line, x, blockY);
      blockY += 5;
    });
    return blockY;
  };

  const emitterEndY = drawBlock(emitterLines, marginX, true);
  const clientEndY = drawBlock(clientLines, colRight, true);
  y = Math.max(emitterEndY, clientEndY) + 6;

  // Tableau des lignes — dessin manuel (pas de plugin autotable installé),
  // en-tête sur bande grise comme le modèle fourni.
  const col = { desc: marginX + 2, qty: pageWidth - 68, unit: pageWidth - 46, total: pageWidth - marginX - 2 };
  doc.setFillColor(245, 245, 245);
  doc.rect(marginX, y, pageWidth - marginX * 2, 8, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('Article', col.desc, y + 5.5);
  doc.text('Qté', col.qty, y + 5.5, { align: 'right' });
  doc.text('P.U.', col.unit, y + 5.5, { align: 'right' });
  doc.text('Total', col.total, y + 5.5, { align: 'right' });
  y += 13;

  doc.setFont('helvetica', 'normal');
  data.items.forEach((item) => {
    const wrapped = doc.splitTextToSize(item.description, col.qty - marginX - 8);
    doc.text(wrapped, col.desc, y);
    doc.text(String(item.quantity), col.qty, y, { align: 'right' });
    doc.text(EUR(item.unitPrice), col.unit, y, { align: 'right' });
    doc.text(EUR(item.lineTotal), col.total, y, { align: 'right' });
    y += 4.5 * wrapped.length + 3;
  });

  doc.setDrawColor(210);
  doc.line(marginX, y, pageWidth - marginX, y);
  y += 7;

  const subtotal = data.items.reduce((sum, i) => sum + i.lineTotal, 0);
  // Reliquat = livraison, ou remise (volume / code promo) quand il est négatif.
  const shipping = data.totalAmount - subtotal;

  doc.setFontSize(9.5);
  doc.text('Sous-total', pageWidth - 60, y);
  doc.text(EUR(subtotal), pageWidth - marginX, y, { align: 'right' });
  if (Math.abs(shipping) > 0.005) {
    y += 5;
    doc.text(shipping < 0 ? 'Remise' : 'Livraison', pageWidth - 60, y);
    doc.text(EUR(shipping), pageWidth - marginX, y, { align: 'right' });
  }
  y += 3;
  doc.setDrawColor(0);
  doc.line(pageWidth - 60, y, pageWidth - marginX, y);
  y += 6;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('TOTAL', pageWidth - 60, y);
  doc.text(EUR(data.totalAmount), pageWidth - marginX, y, { align: 'right' });
  y += 12;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(
    data.paid === false
      ? `Facture à régler par ${data.paymentMethod} à réception.`
      : `Facture acquittée — paiement par ${data.paymentMethod}.`,
    marginX,
    y
  );
  y += 6;

  // Mention légale de TVA — franchise en base (art. 293 B), jamais un
  // régime de marge qui ne s'applique pas à OZË Paris actuellement.
  doc.setFontSize(8);
  doc.setTextColor(120);
  const vatMention = doc.splitTextToSize(
    'TVA non applicable, article 293 B du Code Général des Impôts (franchise en base de TVA).',
    pageWidth - marginX * 2
  );
  doc.text(vatMention, marginX, y);
  doc.setTextColor(0);
};

/** Génère et télécharge le PDF d'UNE facture — jsPDF chargé en dynamique
 * pour ne pas alourdir le bundle principal (déjà une dépendance de ce repo,
 * voir ProductLabel.tsx). */
export const generateInvoicePdf = async (data: InvoiceData): Promise<void> => {
  const { jsPDF } = await importOrReload(() => import('jspdf'));
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  drawInvoicePage(doc, data);
  // Le numéro séquentiel (obligatoire, art. 242 nonies A du CGI) reste
  // affiché SUR le PDF, mais n'a pas à apparaître dans le nom du fichier :
  // un client qui télécharge sa facture ne doit pas voir, rien qu'en
  // regardant son dossier Téléchargements, combien de factures ont déjà été
  // émises au total (référence à la commande uniquement, pas au rang global).
  doc.save(`OZE-Paris_Facture_${data.orderNumber}.pdf`);
};

/**
 * "Export groupé des factures du mois" — un unique PDF multi-pages (une
 * facture par page), pas une archive ZIP : aucune bibliothèque de gestion de
 * ZIP (jszip ou équivalent) n'existe dans ce repo, et le résultat (un seul
 * fichier téléchargeable, imprimable tel quel) rend le même service pour un
 * usage comptable sans ajouter de dépendance.
 */
export const generateInvoicesBulkPdf = async (invoices: InvoiceData[], filename: string): Promise<void> => {
  const { jsPDF } = await importOrReload(() => import('jspdf'));
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  invoices.forEach((data, index) => {
    if (index > 0) doc.addPage();
    drawInvoicePage(doc, data);
  });
  doc.save(filename);
};
