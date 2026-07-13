import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export interface MyB2BOrderItem {
  id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  product_snapshot: { name?: string; images?: string[]; main_image_index?: number; product_code?: string; reference?: string | null };
}

export interface MyB2BOrder {
  id: string;
  order_number: string;
  status: string;
  payment_status: string;
  subtotal: number;
  shipping_cost: number;
  total_amount: number;
  shipping_address: Record<string, unknown>;
  tracking_number: string | null;
  tracking_url: string | null;
  created_at: string;
  order_items: MyB2BOrderItem[];
}

export const useMyB2BOrders = (isAuthenticated: boolean = false) => {
  const [orders, setOrders] = useState<MyB2BOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from('orders')
        .select(
          'id, order_number, status, payment_status, subtotal, shipping_cost, total_amount, shipping_address, tracking_number, tracking_url, created_at, order_items(*)'
        )
        .eq('order_channel', 'b2b')
        .order('created_at', { ascending: false });

      if (fetchError) {
        throw new Error(fetchError.message);
      }

      setOrders((data || []) as unknown as MyB2BOrder[]);
    } catch (err) {
      console.error('Erreur lors du chargement de mes commandes:', err);
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
    fetchOrders();
  }, [isAuthenticated, fetchOrders]);

  return { orders, loading, error, refresh: fetchOrders };
};
