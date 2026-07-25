import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export interface ResellerRevenue {
  reseller_id: string;
  company_name: string;
  orders_count: number;
  total_revenue: number;
  total_purchase_price: number;
  total_profit: number;
}

export const useB2BRevenue = (isAuthenticated: boolean = false) => {
  const [revenue, setRevenue] = useState<ResellerRevenue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRevenue = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from('b2b_order_item_revenue')
        .select('order_id, reseller_id, status, line_total, purchase_price, resellers(company_name)');

      if (fetchError) {
        throw new Error(fetchError.message);
      }

      type Row = {
        order_id: string;
        reseller_id: string;
        status: string;
        line_total: number;
        purchase_price: number;
        resellers: { company_name: string } | null;
      };

      const byReseller = new Map<string, ResellerRevenue & { orderIds: Set<string> }>();
      for (const row of (data || []) as unknown as Row[]) {
        // Un article annulé a été remboursé : ce n'est plus une vente
        // réalisée, ni côté chiffre d'affaires ni côté prix d'achat.
        if (row.status === 'cancelled') continue;

        const existing = byReseller.get(row.reseller_id) || {
          reseller_id: row.reseller_id,
          company_name: row.resellers?.company_name || '—',
          orders_count: 0,
          total_revenue: 0,
          total_purchase_price: 0,
          total_profit: 0,
          orderIds: new Set<string>(),
        };
        existing.orderIds.add(row.order_id);
        existing.total_revenue += Number(row.line_total) || 0;
        existing.total_purchase_price += Number(row.purchase_price) || 0;
        byReseller.set(row.reseller_id, existing);
      }

      const result = Array.from(byReseller.values())
        .map((r) => ({
          reseller_id: r.reseller_id,
          company_name: r.company_name,
          orders_count: r.orderIds.size,
          total_revenue: r.total_revenue,
          total_purchase_price: r.total_purchase_price,
          total_profit: r.total_revenue - r.total_purchase_price,
        }))
        .sort((a, b) => b.total_revenue - a.total_revenue);

      setRevenue(result);
    } catch (err) {
      console.error('Erreur lors du chargement du chiffre d\'affaires B2B:', err);
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }
    fetchRevenue();
  }, [isAuthenticated, fetchRevenue]);

  return { revenue, loading, error, refresh: fetchRevenue };
};
