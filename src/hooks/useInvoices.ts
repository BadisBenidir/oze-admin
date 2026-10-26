import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { generateInvoicePdf, buildInvoiceItems, InvoiceData, InvoiceLineItem, InvoiceBillingDetails, InvoiceSourceItem } from '../utils/generateInvoicePdf';
import { extractFunctionErrorMessage } from '../utils/edgeFunctionError';

export interface OrderInvoiceBadge {
  invoiceType: 'b2b_facturx' | 'b2c_retail';
  transmissionStatus: string;
  qontoEmitted: boolean;
  qontoInvoiceNumber: string | null;
  pdfUrl: string | null;
}

/**
 * Badges admin [B2B - Factur-X] / [B2C - Standard] (Comptabilité, Toutes les
 * commandes, Commandes B2B) — un seul appel groupé par jeu d'ids visibles,
 * jamais une requête par ligne de tableau. N'affiche rien tant que la
 * facture correspondante n'a pas encore été générée (pas d'entrée = pas de
 * badge), ce qui est l'état normal avant le premier téléchargement.
 */
export const useOrderInvoiceBadges = (orderIds: string[]) => {
  const [badges, setBadges] = useState<Record<string, OrderInvoiceBadge>>({});
  const key = orderIds.slice().sort().join(',');

  const fetchBadges = useCallback(async () => {
    if (!key) {
      setBadges({});
      return;
    }
    const { data } = await supabase
      .from('invoices')
      .select('order_id, invoice_type, transmission_status, qonto_invoice_id, qonto_invoice_number, pdf_url')
      .in('order_id', key.split(','));
    if (!data) return;
    const next: Record<string, OrderInvoiceBadge> = {};
    data.forEach((row) => {
      next[row.order_id] = {
        invoiceType: row.invoice_type,
        transmissionStatus: row.transmission_status,
        qontoEmitted: Boolean(row.qonto_invoice_id),
        qontoInvoiceNumber: row.qonto_invoice_number,
        pdfUrl: row.pdf_url,
      };
    });
    setBadges(next);
  }, [key]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!cancelled) await fetchBadges();
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchBadges]);

  // `refresh` : à rappeler après emitQontoInvoice (émission sur Qonto) —
  // sans ça, le badge "Payé/Émis" (icône Send -> CheckCircle2) restait figé
  // jusqu'au rechargement complet de la page, ce fetch initial étant le SEUL
  // endroit qui peuplait `badges` (pas de refetch automatique après action).
  return { badges, refresh: fetchBadges };
};

type MissionEmbed = { reference: string | null; title: string | null };

/** Ligne unique d'une facture d'avance de sourcing (même libellé que sur Qonto). */
export const advanceInvoiceItems = (invoice: {
  total_amount: number | string;
  sourcing_mission?: MissionEmbed | MissionEmbed[] | null;
}): InvoiceLineItem[] => {
  const mission = Array.isArray(invoice.sourcing_mission) ? invoice.sourcing_mission[0] : invoice.sourcing_mission;
  const amount = Number(invoice.total_amount) || 0;
  return [{
    description: ['Avance — Sourcing sur mesure', mission?.reference, mission?.title].filter(Boolean).join(' — '),
    unitPrice: amount,
    quantity: 1,
    lineTotal: amount,
  }];
};

/**
 * Facture commune (0227) : commandes du même acheteur parties ensemble.
 * Renvoie la facture principale du groupe de `invoiceId` et les lignes de
 * TOUTES ses commandes (préfixées par leur numéro), ou null hors groupe.
 */
export const loadSharedInvoice = async (invoiceId: string, mergedIntoId: string | null) => {
  const primaryId = mergedIntoId || invoiceId;
  const { data: group } = await supabase
    .from('invoices')
    .select('id, order_id, invoice_number, issued_at, total_amount, legal_status, billing_details, pdf_url, merged_into_invoice_id')
    .or(`id.eq.${primaryId},merged_into_invoice_id.eq.${primaryId}`);
  if (!group || group.length < 2) return null;
  const primary = group.find((g) => g.id === primaryId);
  if (!primary) return null;

  const { data: orders } = await supabase
    .from('orders')
    .select('id, order_number, created_at, total_amount, late_fee_amount, late_fee_days, order_items(product_snapshot, unit_price, quantity, line_total, status, cancelled_at, insured, insurance_cost, entrupy_requested, entrupy_cost)')
    .in('id', group.map((g) => g.order_id).filter(Boolean) as string[])
    .order('created_at', { ascending: true });
  if (!orders?.length) return null;

  type GroupOrder = { id: string; order_number: string; created_at: string; total_amount: number; late_fee_amount: number | null; late_fee_days: number | null; order_items: InvoiceSourceItem[] };
  const list = orders as unknown as GroupOrder[];
  const items: InvoiceLineItem[] = list.flatMap((o) =>
    buildInvoiceItems(o.order_items || [], { amount: o.late_fee_amount, days: o.late_fee_days }, group.find((g) => g.order_id === o.id)?.issued_at).map((line) => ({
      ...line,
      description: `${o.order_number} — ${line.description}`,
    }))
  );
  return {
    primary,
    items,
    orderNumbers: list.map((o) => o.order_number),
    firstOrderDate: list[0].created_at,
    // Totaux figés des factures du groupe (un article annulé après émission
    // reste facturé, il fait l'objet d'un avoir — 0232).
    totalAmount: group.reduce((sum, g) => sum + (Number(g.total_amount) || 0), 0),
  };
};

export interface InvoiceOrderInput {
  id: string;
  order_number: string;
  created_at: string;
  total_amount: number;
  paymentMethod: string;
}

/**
 * Point d'entrée unique du flux facture — génère (idempotent, voir
 * generate_invoice_for_order dans 0115_invoices.sql), relit la ligne créée
 * pour ses données figées (billing_details), puis rend le PDF côté client.
 * Réutilisé identiquement par le portail revendeur et l'admin pour ne jamais
 * dupliquer cette logique par écran.
 */
export const useInvoices = () => {
  const [downloadingOrderId, setDownloadingOrderId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  /** Appelée juste après qu'un profil complète ses infos légales (voir
   * useResellerAuth.updateLegalInfo) — équivalent pratique du "trigger"
   * demandé, sans déclencheur SQL sur profiles pour éviter de réagir à
   * n'importe quelle autre colonne modifiée. */
  const backfillMissingInvoices = async (profileId?: string) => {
    const { data, error } = await supabase.rpc(
      'backfill_missing_invoices_for_profile',
      profileId ? { p_profile_id: profileId } : {}
    );
    if (error) return { success: false as const, error: error.message };
    return { success: true as const, generated: (data as { generated?: number } | null)?.generated ?? 0 };
  };

  const downloadInvoice = async (order: InvoiceOrderInput, items: InvoiceLineItem[]) => {
    setDownloadingOrderId(order.id);
    setDownloadError(null);
    try {
      const { error: genError } = await supabase.rpc('generate_invoice_for_order', { p_order_id: order.id });
      if (genError) throw new Error(genError.message);

      // Une facture de commande, ou les factures d'avance de la mission de
      // sourcing (plusieurs depuis 0220, avance en plusieurs fois).
      const { data: rows, error: fetchError } = await supabase
        .from('invoices')
        .select('id, invoice_number, issued_at, total_amount, legal_status, billing_details, pdf_url, kind, merged_into_invoice_id, sourcing_mission:b2b_sourcing_missions(reference, title)')
        .eq('order_id', order.id)
        .order('issued_at', { ascending: true });
      if (fetchError || !rows?.length) {
        throw new Error(fetchError?.message || 'Facture introuvable après génération');
      }
      const orderInvoice = rows.find((r) => r.kind === 'order');

      // Facture commune à plusieurs commandes (0227) : un seul PDF pour tout le groupe.
      if (orderInvoice) {
        const shared = await loadSharedInvoice(orderInvoice.id, orderInvoice.merged_into_invoice_id ?? null);
        if (shared) {
          if (shared.primary.pdf_url) {
            window.open(shared.primary.pdf_url, '_blank', 'noopener,noreferrer');
            return { success: true as const };
          }
          await generateInvoicePdf({
            invoiceNumber: shared.primary.invoice_number,
            issuedAt: shared.primary.issued_at,
            orderNumber: shared.orderNumbers.join(' + '),
            orderDate: shared.firstOrderDate,
            totalAmount: Math.round(shared.totalAmount * 100) / 100,
            legalStatus: shared.primary.legal_status as 'individual' | 'sole_proprietorship' | 'company',
            billingDetails: (shared.primary.billing_details || {}) as InvoiceBillingDetails,
            paymentMethod: order.paymentMethod,
            items: shared.items,
          });
          return { success: true as const };
        }
      }
      const invoices = orderInvoice ? [orderInvoice] : rows;

      // Facture figée : les articles annulés APRÈS son émission y restent
      // (ils font l'objet d'un avoir, 0232).
      let orderItems = items;
      if (orderInvoice) {
        const { data: fresh } = await supabase
          .from('orders')
          .select('late_fee_amount, late_fee_days, order_items(product_snapshot, unit_price, quantity, line_total, status, cancelled_at, insured, insurance_cost, entrupy_requested, entrupy_cost)')
          .eq('id', order.id)
          .maybeSingle();
        if (fresh) {
          const f = fresh as unknown as { late_fee_amount: number | null; late_fee_days: number | null; order_items: InvoiceSourceItem[] };
          orderItems = buildInvoiceItems(f.order_items || [], { amount: f.late_fee_amount, days: f.late_fee_days }, orderInvoice.issued_at);
        }
      }

      for (const invoice of invoices) {
        // Une fois la facture officielle émise sur Qonto (voir
        // emit-qonto-invoice), son PDF certifié remplace le PDF jsPDF généré
        // à la volée — jamais l'inverse.
        if (invoice.pdf_url) {
          window.open(invoice.pdf_url, '_blank', 'noopener,noreferrer');
          continue;
        }
        await generateInvoicePdf({
          invoiceNumber: invoice.invoice_number,
          issuedAt: invoice.issued_at,
          orderNumber: order.order_number,
          orderDate: order.created_at,
          totalAmount: Number(invoice.total_amount),
          legalStatus: invoice.legal_status as 'individual' | 'sole_proprietorship' | 'company',
          billingDetails: (invoice.billing_details || {}) as InvoiceBillingDetails,
          paymentMethod: order.paymentMethod,
          // Facture d'avance de sourcing rattachée à la commande (0196) : elle
          // ne facture que l'avance, jamais le détail des pièces.
          items: invoice.kind === 'advance' ? advanceInvoiceItems(invoice) : orderItems,
        });
      }

      return { success: true as const };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de la génération de la facture';
      setDownloadError(message);
      return { success: false as const, error: message };
    } finally {
      setDownloadingOrderId(null);
    }
  };

  /** Émission réelle sur Qonto (admin uniquement, voir emit-qonto-invoice) —
   * action explicite et volontairement distincte du téléchargement : une
   * émission finalisée est irréversible côté Qonto. */
  const emitQontoInvoice = async (orderId: string) => {
    setDownloadingOrderId(orderId);
    setDownloadError(null);
    try {
      const { data, error } = await supabase.functions.invoke('emit-qonto-invoice', { body: { order_id: orderId } });
      if (error) throw new Error(await extractFunctionErrorMessage(error, "Échec de l'émission sur Qonto"));
      const result = data as {
        already_emitted?: boolean;
        qonto_invoice_id?: string;
        qonto_invoice_number?: string;
        pdf_url?: string;
      };
      return {
        success: true as const,
        already_emitted: result?.already_emitted,
        qonto_invoice_id: result?.qonto_invoice_id,
        qonto_invoice_number: result?.qonto_invoice_number,
        pdf_url: result?.pdf_url,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erreur lors de l'émission sur Qonto";
      setDownloadError(message);
      return { success: false as const, error: message };
    } finally {
      setDownloadingOrderId(null);
    }
  };

  return { downloadInvoice, backfillMissingInvoices, emitQontoInvoice, downloadingOrderId, downloadError };
};

/** Facture d'avance d'une mission de sourcing (0196) — plusieurs par mission
 * depuis 0220 (avance en plusieurs fois, jusqu'au budget total), émises sur
 * Qonto pour en demander le paiement par virement. transmissionStatus = statut
 * Qonto ('unpaid' → 'paid', relu par qonto-sync qui met à jour l'encaissé). */
export interface AdvanceInvoice {
  id: string;
  invoiceNumber: string;
  issuedAt: string;
  totalAmount: number;
  transmissionStatus: string;
  qontoEmitted: boolean;
  qontoInvoiceNumber: string | null;
  pdfUrl: string | null;
}

/**
 * Émet une facture d'avance sur Qonto : nouvelle facture de `amount` € (par
 * défaut, tout le reste à facturer), ou facture déjà générée `invoiceId`.
 */
export const emitAdvanceInvoice = async (missionId: string, opts: { amount?: number; invoiceId?: string } = {}) => {
  try {
    const { data, error } = await supabase.functions.invoke('emit-qonto-invoice', {
      body: {
        sourcing_mission_id: missionId,
        ...(opts.amount !== undefined ? { amount: opts.amount } : {}),
        ...(opts.invoiceId ? { invoice_id: opts.invoiceId } : {}),
      },
    });
    if (error) throw new Error(await extractFunctionErrorMessage(error, "Échec de l'émission sur Qonto"));
    const result = data as {
      already_emitted?: boolean;
      qonto_invoice_number?: string;
      pdf_url?: string;
      /** Email « Votre facture d'avance » envoyé au membre depuis nepasrepondre@ozeparis.com. */
      email_sent?: boolean;
      email_error?: string | null;
    };
    return { success: true as const, ...result };
  } catch (err) {
    return { success: false as const, error: err instanceof Error ? err.message : "Erreur lors de l'émission sur Qonto" };
  }
};

/** Renvoie au membre l'email d'une facture d'avance déjà émise (sans nouvelle émission Qonto). */
export const resendAdvanceInvoiceEmail = async (missionId: string, invoiceId?: string) => {
  try {
    const { error } = await supabase.functions.invoke('emit-qonto-invoice', {
      body: { sourcing_mission_id: missionId, resend_email: true, ...(invoiceId ? { invoice_id: invoiceId } : {}) },
    });
    if (error) throw new Error(await extractFunctionErrorMessage(error, "Échec de l'envoi de l'email"));
    return { success: true as const };
  } catch (err) {
    return { success: false as const, error: err instanceof Error ? err.message : "Échec de l'envoi de l'email" };
  }
};

export const useAdvanceInvoices = (missionId: string | null) => {
  const [invoices, setInvoices] = useState<AdvanceInvoice[]>([]);
  const [emitting, setEmitting] = useState(false);

  const refresh = useCallback(async () => {
    if (!missionId) {
      setInvoices([]);
      return;
    }
    const { data } = await supabase
      .from('invoices')
      .select('id, invoice_number, issued_at, total_amount, transmission_status, qonto_invoice_id, qonto_invoice_number, pdf_url')
      .eq('sourcing_mission_id', missionId)
      .eq('kind', 'advance')
      .order('issued_at', { ascending: true });
    setInvoices(
      (data || []).map((d) => ({
        id: d.id,
        invoiceNumber: d.invoice_number,
        issuedAt: d.issued_at,
        totalAmount: Number(d.total_amount),
        transmissionStatus: d.transmission_status,
        qontoEmitted: Boolean(d.qonto_invoice_id),
        qontoInvoiceNumber: d.qonto_invoice_number,
        pdfUrl: d.pdf_url,
      }))
    );
  }, [missionId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /** PDF officiel Qonto s'il existe, sinon PDF généré localement (jsPDF). */
  const download = async (invoiceId: string) => {
    const { data } = await supabase
      .from('invoices')
      .select('invoice_number, issued_at, total_amount, legal_status, billing_details, pdf_url, transmission_status, sourcing_mission:b2b_sourcing_missions(reference, title, created_at, paid_at)')
      .eq('id', invoiceId)
      .maybeSingle();
    if (!data) return;
    if (data.pdf_url) {
      window.open(data.pdf_url, '_blank', 'noopener,noreferrer');
      return;
    }
    const mission = (Array.isArray(data.sourcing_mission) ? data.sourcing_mission[0] : data.sourcing_mission) as
      | (MissionEmbed & { created_at: string; paid_at: string | null })
      | null;
    await generateInvoicePdf({
      invoiceNumber: data.invoice_number,
      issuedAt: data.issued_at,
      orderNumber: mission?.reference || data.invoice_number,
      orderDate: mission?.created_at || data.issued_at,
      totalAmount: Number(data.total_amount),
      legalStatus: data.legal_status as 'individual' | 'sole_proprietorship' | 'company',
      billingDetails: (data.billing_details || {}) as InvoiceBillingDetails,
      paymentMethod: 'virement bancaire',
      items: advanceInvoiceItems(data),
      paid: data.transmission_status === 'paid',
    });
  };

  /** Nouvelle facture (`amount`, défaut : reste à facturer) ou émission d'une facture déjà générée. */
  const emit = async (opts: { amount?: number; invoiceId?: string } = {}) => {
    if (!missionId) return { success: false as const, error: 'Mission introuvable' };
    setEmitting(true);
    const result = await emitAdvanceInvoice(missionId, opts);
    setEmitting(false);
    await refresh();
    return result;
  };

  return { invoices, emitting, emit, download, refresh };
};

// ---------------------------------------------------------------------------
// Avoirs (0232) : un par article annulé et remboursé après l'émission de la
// facture de sa commande. PDF régénéré à la demande, comme les factures.
// ---------------------------------------------------------------------------

export interface CreditNoteRow {
  id: string;
  credit_note_number: string;
  issued_at: string;
  amount: number;
  refund_method: string | null;
  reason: string | null;
  legal_status: 'individual' | 'sole_proprietorship' | 'company';
  billing_details: InvoiceBillingDetails;
  lines: InvoiceLineItem[];
  order_item_id: string;
  invoice: { invoice_number: string } | null;
  order: { order_number: string; created_at: string } | null;
}

export const CREDIT_NOTE_SELECT =
  'id, credit_note_number, issued_at, amount, refund_method, reason, legal_status, billing_details, lines, order_item_id, ' +
  'invoice:invoices(invoice_number), order:orders(order_number, created_at)';

const refundMethodText = (m: string | null) =>
  m === 'stripe' ? 'par carte bancaire (Stripe)' : m === 'wallet' ? 'en crédit sur le solde revendeur (wallet)' : 'selon le mode de paiement d\'origine';

export const creditNotePdfData = (cn: CreditNoteRow): InvoiceData => ({
  invoiceNumber: cn.credit_note_number,
  issuedAt: cn.issued_at,
  orderNumber: cn.order?.order_number || '',
  orderDate: cn.order?.created_at || cn.issued_at,
  totalAmount: Number(cn.amount),
  legalStatus: cn.legal_status,
  billingDetails: cn.billing_details || {},
  paymentMethod: '',
  items: cn.lines || [],
  creditNote: { invoiceNumber: cn.invoice?.invoice_number || '', reason: cn.reason, refundMethod: refundMethodText(cn.refund_method) },
});

export const downloadCreditNote = async (cn: CreditNoteRow) => generateInvoicePdf(creditNotePdfData(cn));

export const useOrderCreditNotes = (orderId: string | null | undefined) => {
  const [creditNotes, setCreditNotes] = useState<CreditNoteRow[]>([]);
  const refresh = useCallback(async () => {
    if (!orderId) {
      setCreditNotes([]);
      return;
    }
    const { data, error } = await supabase.from('credit_notes').select(CREDIT_NOTE_SELECT).eq('order_id', orderId).order('issued_at');
    setCreditNotes(error ? [] : ((data || []) as unknown as CreditNoteRow[]));
  }, [orderId]);
  useEffect(() => { refresh(); }, [refresh]);
  return { creditNotes, refresh };
};
