import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export interface B2BOrderItem {
  id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  product_snapshot: { name?: string; images?: string[]; main_image_index?: number; product_code?: string; reference?: string | null };
  status: 'active' | 'cancelled';
  cancellation_reason: string | null;
  cancelled_at: string | null;
  restock_action: 'draft' | 'for-sale-b2b' | 'archived' | null;
  refund_status: 'not_applicable' | 'succeeded' | 'failed' | null;
}

export interface B2BOrder {
  id: string;
  order_number: string;
  status: string;
  email: string;
  subtotal: number;
  shipping_cost: number;
  total_amount: number;
  shipping_address: Record<string, unknown>;
  created_at: string;
  reseller_id: string;
  reseller: { company_name: string } | null;
  order_items: B2BOrderItem[];
}

export const useB2BOrders = (isAuthenticated: boolean = false, resellerId?: string) => {
  const [orders, setOrders] = useState<B2BOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      let query = supabase
        .from('orders')
        .select(
          'id, order_number, status, email, subtotal, shipping_cost, total_amount, shipping_address, created_at, reseller_id, reseller:resellers(company_name), order_items(*)'
        )
        .eq('order_channel', 'b2b');

      if (resellerId) {
        query = query.eq('reseller_id', resellerId);
      }

      const { data, error: fetchError } = await query.order('created_at', { ascending: false });

      if (fetchError) {
        throw new Error(fetchError.message);
      }

      setOrders((data || []) as unknown as B2BOrder[]);
    } catch (err) {
      console.error('Erreur lors du chargement des commandes B2B:', err);
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }, [resellerId]);

  useEffect(() => {
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }
    fetchOrders();
  }, [isAuthenticated, fetchOrders]);

  return { orders, loading, error, refresh: fetchOrders };
};
