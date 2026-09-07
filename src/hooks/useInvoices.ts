import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { generateInvoicePdf, InvoiceLineItem, InvoiceBillingDetails } from '../utils/generateInvoicePdf';

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
        .select('invoice_number, issued_at, total_amount, legal_status, billing_details')
        .eq('order_id', order.id)
        .single();
      if (fetchError || !invoice) {
        throw new Error(fetchError?.message || 'Facture introuvable après génération');
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

  return { downloadInvoice, backfillMissingInvoices, downloadingOrderId, downloadError };
};
