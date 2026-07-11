import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export interface ResellerMargin {
  reseller_id: string;
  company_name: string;
  orders_count: number;
  wholesale_total: number;
  catalog_total: number;
  margin_total: number;
}

export const useB2BMargins = (isAuthenticated: boolean = false) => {
  const [margins, setMargins] = useState<ResellerMargin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMargins = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from('b2b_order_margins')
        .select('reseller_id, wholesale_subtotal, catalog_subtotal, resellers(company_name)');

      if (fetchError) {
        throw new Error(fetchError.message);
      }

      const byReseller = new Map<string, ResellerMargin>();
      for (const row of (data || []) as unknown as Array<{
        reseller_id: string;
        wholesale_subtotal: number;
        catalog_subtotal: number;
        resellers: { company_name: string } | null;
      }>) {
        const existing = byReseller.get(row.reseller_id) || {
          reseller_id: row.reseller_id,
          company_name: row.resellers?.company_name || '—',
          orders_count: 0,
          wholesale_total: 0,
          catalog_total: 0,
          margin_total: 0,
        };
        existing.orders_count += 1;
        existing.wholesale_total += Number(row.wholesale_subtotal) || 0;
        existing.catalog_total += Number(row.catalog_subtotal) || 0;
        existing.margin_total = existing.catalog_total - existing.wholesale_total;
        byReseller.set(row.reseller_id, existing);
      }

      setMargins(Array.from(byReseller.values()).sort((a, b) => b.margin_total - a.margin_total));
    } catch (err) {
      console.error('Erreur lors du chargement des marges B2B:', err);
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
    fetchMargins();
  }, [isAuthenticated, fetchMargins]);

  return { margins, loading, error, refresh: fetchMargins };
};
