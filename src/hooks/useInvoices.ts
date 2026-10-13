import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { generateInvoicePdf, InvoiceLineItem, InvoiceBillingDetails } from '../utils/generateInvoicePdf';
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

      const { data: invoice, error: fetchError } = await supabase
        .from('invoices')
        .select('invoice_number, issued_at, total_amount, legal_status, billing_details, pdf_url, kind, sourcing_mission:b2b_sourcing_missions(reference, title)')
        .eq('order_id', order.id)
        .single();
      if (fetchError || !invoice) {
        throw new Error(fetchError?.message || 'Facture introuvable après génération');
      }

      // Une fois la facture officielle émise sur Qonto (voir
      // emit-qonto-invoice), son PDF certifié remplace le PDF jsPDF généré
      // à la volée — jamais l'inverse.
      if (invoice.pdf_url) {
        window.open(invoice.pdf_url, '_blank', 'noopener,noreferrer');
        return { success: true as const };
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
        items: invoice.kind === 'advance' ? advanceInvoiceItems(invoice) : items,
      });

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

/** Facture d'avance d'une mission de sourcing (0196) : une seule facture par
 * mission, du montant de l'avance, émise sur Qonto pour en demander le
 * paiement par virement. transmissionStatus = statut Qonto ('unpaid' →
 * 'paid', relu par qonto-sync qui marque alors l'avance encaissée). */
export interface AdvanceInvoice {
  invoiceNumber: string;
  totalAmount: number;
  transmissionStatus: string;
  qontoEmitted: boolean;
  qontoInvoiceNumber: string | null;
  pdfUrl: string | null;
}

export const emitAdvanceInvoice = async (missionId: string) => {
  try {
    const { data, error } = await supabase.functions.invoke('emit-qonto-invoice', { body: { sourcing_mission_id: missionId } });
    if (error) throw new Error(await extractFunctionErrorMessage(error, "Échec de l'émission sur Qonto"));
    const result = data as { already_emitted?: boolean; qonto_invoice_number?: string; pdf_url?: string };
    return { success: true as const, ...result };
  } catch (err) {
    return { success: false as const, error: err instanceof Error ? err.message : "Erreur lors de l'émission sur Qonto" };
  }
};

export const useAdvanceInvoice = (missionId: string | null) => {
  const [invoice, setInvoice] = useState<AdvanceInvoice | null>(null);
  const [emitting, setEmitting] = useState(false);

  const refresh = useCallback(async () => {
    if (!missionId) {
      setInvoice(null);
      return;
    }
    const { data } = await supabase
      .from('invoices')
      .select('invoice_number, total_amount, transmission_status, qonto_invoice_id, qonto_invoice_number, pdf_url')
      .eq('sourcing_mission_id', missionId)
      .maybeSingle();
    setInvoice(
      data
        ? {
            invoiceNumber: data.invoice_number,
            totalAmount: Number(data.total_amount),
            transmissionStatus: data.transmission_status,
            qontoEmitted: Boolean(data.qonto_invoice_id),
            qontoInvoiceNumber: data.qonto_invoice_number,
            pdfUrl: data.pdf_url,
          }
        : null
    );
  }, [missionId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /** PDF officiel Qonto s'il existe, sinon PDF généré localement (jsPDF). */
  const download = async () => {
    if (!missionId) return;
    const { data } = await supabase
      .from('invoices')
      .select('invoice_number, issued_at, total_amount, legal_status, billing_details, pdf_url, transmission_status, sourcing_mission:b2b_sourcing_missions(reference, title, created_at, paid_at)')
      .eq('sourcing_mission_id', missionId)
      .maybeSingle();
    if (!data) return;
    if (data.pdf_url) {
      window.open(data.pdf_url, '_blank', 'noopener,noreferrer');
      return;
    }
    const mission = (Array.isArray(data.sourcing_mission) ? data.sourcing_mission[0] : data.sourcing_mission) as
      | (MissionEmbed & { created_at: string; paid_at: string | null })
      | null;
    const paidAt = mission?.paid_at;
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
      paid: Boolean(paidAt) || data.transmission_status === 'paid',
    });
  };

  const emit = async () => {
    if (!missionId) return { success: false as const, error: 'Mission introuvable' };
    setEmitting(true);
    const result = await emitAdvanceInvoice(missionId);
    setEmitting(false);
    await refresh();
    return result;
  };

  return { invoice, emitting, emit, download, refresh };
};
