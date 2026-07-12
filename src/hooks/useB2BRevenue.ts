import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export interface ResellerRevenue {
  reseller_id: string;
  company_name: string;
  orders_count: number;
  total_revenue: number;
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
        .from('b2b_reseller_revenue')
        .select('reseller_id, subtotal, resellers(company_name)');

      if (fetchError) {
        throw new Error(fetchError.message);
      }

      const byReseller = new Map<string, ResellerRevenue>();
      for (const row of (data || []) as unknown as Array<{
        reseller_id: string;
        subtotal: number;
        resellers: { company_name: string } | null;
      }>) {
        const existing = byReseller.get(row.reseller_id) || {
          reseller_id: row.reseller_id,
          company_name: row.resellers?.company_name || '—',
          orders_count: 0,
          total_revenue: 0,
        };
        existing.orders_count += 1;
        existing.total_revenue += Number(row.subtotal) || 0;
        byReseller.set(row.reseller_id, existing);
      }

      setRevenue(Array.from(byReseller.values()).sort((a, b) => b.total_revenue - a.total_revenue));
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
