import { supabase } from '../lib/supabase';
import { renderInvoicePdfBlob, InvoiceBillingDetails } from './generateInvoicePdf';
import { advanceInvoiceItems, getOrderInvoiceForChat } from '../hooks/useInvoices';

/** Facture candidate comme justificatif d'un encaissement Qonto. */
export interface AttachableInvoice {
  id: string;
  invoice_number: string;
  qonto_invoice_number: string | null;
  qonto_invoice_id: string | null;
  kind: 'order' | 'advance' | 'service';
  total_amount: number;
  issued_at: string;
  order_id: string | null;
  sourcing_mission_id: string | null;
  vat_rate: number | null;
  legal_status: string;
  billing_details: InvoiceBillingDetails | null;
  service_label: string | null;
  transmission_status: string;
  profile: { first_name: string | null; last_name: string | null } | null;
  sourcing_mission: { reference: string | null; title: string | null } | null;
  order: { order_number: string } | null;
}

export const ATTACHABLE_INVOICE_SELECT =
  'id, invoice_number, qonto_invoice_number, qonto_invoice_id, kind, total_amount, issued_at, order_id, sourcing_mission_id, vat_rate, ' +
  'legal_status, billing_details, service_label, transmission_status, profile:profiles(first_name, last_name), ' +
  'sourcing_mission:b2b_sourcing_missions(reference, title), order:orders!invoices_order_id_fkey(order_number)';

export const invoiceLabel = (i: AttachableInvoice) => i.qonto_invoice_number || i.invoice_number;

export const invoiceClientName = (i: AttachableInvoice) =>
  [i.profile?.first_name, i.profile?.last_name].filter(Boolean).join(' ').trim() ||
  i.billing_details?.name || i.billing_details?.entity_name || '';

const blobToBase64 = async (blob: Blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

/** PDF d'une facture de l'admin (non émise sur Qonto) : même modèle que
 * « Télécharger la facture ». Les factures émises sur Qonto sont relues
 * côté serveur (PDF officiel). */
const renderAdminInvoicePdf = async (i: AttachableInvoice): Promise<Blob> => {
  if (i.kind === 'order' && i.order_id) {
    const chat = await getOrderInvoiceForChat(i.order_id);
    if (chat.kind === 'pdf') return chat.blob;
    throw new Error(`Facture ${invoiceLabel(i)} : PDF Qonto non disponible`);
  }
  const { blob } = await renderInvoicePdfBlob({
    invoiceNumber: i.invoice_number,
    issuedAt: i.issued_at,
    orderNumber: i.kind === 'advance' ? i.sourcing_mission?.reference || i.invoice_number : 'Prestation',
    orderDate: i.issued_at,
    totalAmount: Number(i.total_amount),
    vatRate: i.vat_rate,
    legalStatus: i.legal_status as 'individual' | 'sole_proprietorship' | 'company',
    billingDetails: i.billing_details || {},
    paymentMethod: 'virement bancaire',
    paid: true,
    items:
      i.kind === 'advance'
        ? advanceInvoiceItems({ total_amount: i.total_amount, sourcing_mission: i.sourcing_mission })
        : [{ description: i.service_label || 'Prestation', unitPrice: Number(i.total_amount), quantity: 1, lineTotal: Number(i.total_amount) }],
  });
  return blob;
};

/** Dépose la facture sur la transaction Qonto de l'encaissement. */
export const attachInvoiceToTransaction = async (bankTransactionId: string, invoice: AttachableInvoice) => {
  const body: Record<string, unknown> = { bank_transaction_id: bankTransactionId, invoice_id: invoice.id };
  if (!invoice.qonto_invoice_id) {
    body.data_base64 = await blobToBase64(await renderAdminInvoicePdf(invoice));
    body.filename = `OZE-Paris_Facture_${invoice.invoice_number}.pdf`;
  }
  const { data, error } = await supabase.functions.invoke('qonto-attach-invoice', { body });
  if (error) {
    let message = error.message;
    try {
      const parsed = await (error as unknown as { context?: Response }).context?.json();
      message = parsed?.error || message;
    } catch { /* corps non JSON */ }
    throw new Error(message);
  }
  if (data?.error) throw new Error(String(data.error));
};

// ---------------------------------------------------------------------------
// Proposition automatique facture ↔ encaissement.

export interface UnjustifiedCredit {
  id: string;
  label: string | null;
  counterparty_name: string | null;
  amount: number;
  settled_at: string | null;
  emitted_at: string | null;
  matched_sourcing_mission_id: string | null;
  matched_order_id: string | null;
}

const tokens = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1 && !['ei', 'm', 'mr', 'mme', 'sas', 'sarl'].includes(t));

/** Le libellé du virement contient le nom du client de la facture (ou l'inverse). */
const nameMatches = (label: string, i: AttachableInvoice) => {
  const lt = new Set(tokens(label));
  const it = tokens(invoiceClientName(i));
  if (it.length < 2 || lt.size === 0) return false;
  return it.filter((t) => lt.has(t)).length >= 2;
};

const dayDiff = (a: string, b: string) => Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86400000;

export interface Candidate { invoice: AttachableInvoice; score: number; reason: string }

/** Factures candidates pour un encaissement, la meilleure en premier :
 *  rapprochement Qonto (mission / commande), puis nom du client + même
 *  montant, puis nom du client + facture couvrant plusieurs paiements. */
export const candidatesFor = (tx: UnjustifiedCredit, invoices: AttachableInvoice[]): Candidate[] => {
  const label = `${tx.counterparty_name || ''} ${tx.label || ''}`;
  const date = tx.settled_at || tx.emitted_at || '';
  const out: Candidate[] = [];
  for (const i of invoices) {
    const amount = Number(i.total_amount);
    const same = Math.abs(amount - Number(tx.amount)) < 0.005;
    let score = 0;
    let reason = '';
    if (tx.matched_sourcing_mission_id && i.sourcing_mission_id === tx.matched_sourcing_mission_id) {
      score = same ? 4 : 3;
      reason = `sourcing ${i.sourcing_mission?.reference || ''}`;
    } else if (tx.matched_order_id && i.order_id === tx.matched_order_id) {
      score = same ? 4 : 3;
      reason = `commande ${i.order?.order_number || ''}`;
    } else if (nameMatches(label, i)) {
      if (same) { score = 2.5; reason = 'même client, même montant'; }
      else if (amount > Number(tx.amount)) { score = 1; reason = 'même client, facture couvrant plusieurs paiements'; }
    }
    if (score) out.push({ invoice: i, score: score - Math.min(dayDiff(date, i.issued_at), 90) / 1000, reason });
  }
  return out.sort((a, b) => b.score - a.score);
};

/** Une proposition par encaissement ; une facture du même montant n'est
 * proposée qu'une fois (ex. deux virements de 100 € → deux factures de 100 €),
 * une facture couvrant plusieurs paiements peut servir plusieurs fois. */
export const proposeInvoices = (credits: UnjustifiedCredit[], invoices: AttachableInvoice[]) => {
  const used = new Set<string>();
  const proposals: Record<string, string | null> = {};
  const ordered = [...credits].sort((a, b) => candidatesFor(a, invoices).length - candidatesFor(b, invoices).length);
  for (const tx of ordered) {
    const pick = candidatesFor(tx, invoices).find((c) => {
      const exact = Math.abs(Number(c.invoice.total_amount) - Number(tx.amount)) < 0.005;
      return !(exact && used.has(c.invoice.id));
    });
    if (pick) {
      if (Math.abs(Number(pick.invoice.total_amount) - Number(tx.amount)) < 0.005) used.add(pick.invoice.id);
      proposals[tx.id] = pick.invoice.id;
    } else proposals[tx.id] = null;
  }
  return proposals;
};
