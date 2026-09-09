import { useEffect, useState } from 'react';
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

  useEffect(() => {
    if (!key) {
      setBadges({});
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('invoices')
        .select('order_id, invoice_type, transmission_status, qonto_invoice_id, qonto_invoice_number, pdf_url')
        .in('order_id', key.split(','));
      if (cancelled || !data) return;
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
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return badges;
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
        .select('invoice_number, issued_at, total_amount, legal_status, billing_details, pdf_url')
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
        items,
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
