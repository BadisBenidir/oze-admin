import React, { useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { generateInvoicesBulkPdf, InvoiceData, InvoiceBillingDetails } from '../../../utils/generateInvoicePdf';
import { AccountingPeriod } from '../../../utils/accountingPeriods';
import { FileDown, Loader2 } from 'lucide-react';

interface InvoicesBulkExportProps {
  period: AccountingPeriod;
}

interface OrderItemRow {
  product_snapshot: { name?: string } | null;
  unit_price: number;
  quantity: number;
  line_total: number;
  status?: string;
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
  order_items: OrderItemRow[] | null;
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
          'order_number, created_at, stripe_payment_intent_id, ' +
            'order_items(product_snapshot, unit_price, quantity, line_total, status), ' +
            'invoice:invoices!inner(invoice_number, issued_at, total_amount, legal_status, billing_details)'
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

      const invoicesData: InvoiceData[] = rows
        .map((row) => {
          const invoice = Array.isArray(row.invoice) ? row.invoice[0] : row.invoice;
          if (!invoice) return null;
          const items = (row.order_items || [])
            .filter((i) => i.status !== 'cancelled')
            .map((i) => ({
              description: i.product_snapshot?.name || 'Article',
              unitPrice: i.unit_price,
              quantity: i.quantity,
              lineTotal: i.line_total,
            }));
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
