import React, { useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { generateInvoicesBulkPdf, buildInvoiceItems, InvoiceData, InvoiceBillingDetails, InvoiceSourceItem } from '../../../utils/generateInvoicePdf';
import { loadSharedInvoice } from '../../../hooks/useInvoices';
import { AccountingPeriod } from '../../../utils/accountingPeriods';
import { FileDown, Loader2 } from 'lucide-react';

interface InvoicesBulkExportProps {
  period: AccountingPeriod;
}

interface InvoiceEmbed {
  invoice_number: string;
  issued_at: string;
  total_amount: number;
  legal_status: 'individual' | 'sole_proprietorship' | 'company';
  billing_details: InvoiceBillingDetails;
}

interface OrderRow {
  order_number: string;
  created_at: string;
  stripe_payment_intent_id: string | null;
  order_items: InvoiceSourceItem[] | null;
  late_fee_amount?: number | null;
  late_fee_days?: number | null;
  invoice: InvoiceEmbed | InvoiceEmbed[] | null;
}

/**
 * "Export groupé des factures du mois" (Comptabilité & Finances) — un seul
 * PDF multi-pages regroupant toutes les factures déjà émises (voir
 * 0115_invoices.sql) sur la période choisie dans le sélecteur global de
 * l'onglet, pas nécessairement "le mois" au sens strict : suit le preset
 * réellement actif (mois courant par défaut, mais aussi trimestre/YTD/
 * période personnalisée si l'admin les sélectionne), plutôt que de dupliquer
 * un sélecteur de date indépendant.
 */
export const InvoicesBulkExport: React.FC<InvoicesBulkExportProps> = ({ period }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleExport = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: fetchError } = await supabase
        .from('orders')
        .select(
          'order_number, created_at, stripe_payment_intent_id, late_fee_amount, late_fee_days, ' +
            'order_items(product_snapshot, unit_price, quantity, line_total, status, insured, insurance_cost, entrupy_requested, entrupy_cost), ' +
            'invoice:invoices!inner(id, kind, merged_into_invoice_id, invoice_number, issued_at, total_amount, legal_status, billing_details)'
        )
        .gte('created_at', period.range.start.toISOString())
        .lte('created_at', period.range.end.toISOString())
        .order('created_at', { ascending: true });

      if (fetchError) throw new Error(fetchError.message);

      const rows = (data || []) as unknown as OrderRow[];
      if (rows.length === 0) {
        setError('Aucune facture émise sur cette période.');
        return;
      }

      // Facture commune (0227) : la facture rattachée n'est pas exportée seule,
      // la facture principale reprend les articles de tout le groupe.
      const invoiceOf = (row: OrderRow) => {
        const list = (Array.isArray(row.invoice) ? row.invoice : [row.invoice]) as unknown as ({ id: string; kind?: string; merged_into_invoice_id?: string | null } & Record<string, unknown>)[];
        return list.find((i) => i && i.kind !== 'advance') || list[0] || null;
      };
      const shared = new Map<string, Awaited<ReturnType<typeof loadSharedInvoice>>>();
      for (const row of rows) {
        const inv = invoiceOf(row);
        if (inv && !inv.merged_into_invoice_id) {
          const group = await loadSharedInvoice(inv.id, null);
          if (group) shared.set(inv.id, group);
        }
      }

      const invoicesData: InvoiceData[] = rows
        .map((row) => {
          const invoice = invoiceOf(row) as unknown as (InvoiceEmbed & { id: string; merged_into_invoice_id?: string | null }) | null;
          if (!invoice || invoice.merged_into_invoice_id) return null;
          const group = shared.get(invoice.id);
          if (group) {
            const groupData: InvoiceData = {
              invoiceNumber: invoice.invoice_number,
              issuedAt: invoice.issued_at,
              orderNumber: group.orderNumbers.join(' + '),
              orderDate: group.firstOrderDate,
              totalAmount: Math.round(group.totalAmount * 100) / 100,
              legalStatus: invoice.legal_status,
              billingDetails: invoice.billing_details || {},
              paymentMethod: row.stripe_payment_intent_id ? 'Carte bancaire (Stripe)' : 'Solde revendeur (wallet)',
              items: group.items,
            };
            return groupData;
          }
          const items = buildInvoiceItems(row.order_items || [], { amount: row.late_fee_amount, days: row.late_fee_days });
          const invoiceData: InvoiceData = {
            invoiceNumber: invoice.invoice_number,
            issuedAt: invoice.issued_at,
            orderNumber: row.order_number,
            orderDate: row.created_at,
            totalAmount: Number(invoice.total_amount),
            legalStatus: invoice.legal_status,
            billingDetails: invoice.billing_details || {},
            paymentMethod: row.stripe_payment_intent_id ? 'Carte bancaire (Stripe)' : 'Solde revendeur (wallet)',
            items,
          };
          return invoiceData;
        })
        .filter((x): x is InvoiceData => x !== null);

      const safeLabel = period.label.replace(/[^\w-]+/g, '_');
      await generateInvoicesBulkPdf(invoicesData, `Factures_${safeLabel}.pdf`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur lors de l'export des factures");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mb-6">
      <button
        onClick={handleExport}
        disabled={loading}
        className="flex items-center gap-2 px-4 py-2 border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm disabled:opacity-50"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
        <span>Export groupé des factures ({period.label})</span>
      </button>
      {error && <p className="text-xs text-red-600 mt-1.5">{error}</p>}
    </div>
  );
};
