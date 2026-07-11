import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { resellerOrderService } from '../services/resellerOrderService';

export interface B2BOrderItem {
  id: string;
  product_id: string;
  unit_price: number;
  line_total: number;
  product_snapshot: { name?: string; images?: string[]; main_image_index?: number };
}

export interface B2BOrder {
  id: string;
  order_number: string;
  status: string;
  approval_status: 'pending_approval' | 'approved' | 'rejected' | null;
  rejection_reason: string | null;
  subtotal: number;
  total_amount: number;
  shipping_address: Record<string, unknown>;
  created_at: string;
  reseller_id: string;
  reseller: { company_name: string } | null;
  order_items: B2BOrderItem[];
}

export const useB2BOrders = (isAuthenticated: boolean = false) => {
  const [orders, setOrders] = useState<B2BOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from('orders')
        .select(
          'id, order_number, status, approval_status, rejection_reason, subtotal, total_amount, shipping_address, created_at, reseller_id, reseller:resellers(company_name), order_items(*)'
        )
        .eq('order_channel', 'b2b')
        .order('created_at', { ascending: false });

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
  }, []);

  const approveOrder = async (orderId: string): Promise<{ success: boolean; error?: string }> => {
    setActionError(null);
    try {
      await resellerOrderService.approveOrder(orderId);
      await fetchOrders();
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur inconnue';
      setActionError(message);
      return { success: false, error: message };
    }
  };

  const rejectOrder = async (orderId: string, reason: string): Promise<{ success: boolean; error?: string }> => {
    setActionError(null);
    try {
      await resellerOrderService.rejectOrder(orderId, reason);
      await fetchOrders();
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur inconnue';
      setActionError(message);
      return { success: false, error: message };
    }
  };

  useEffect(() => {
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }
    fetchOrders();
  }, [isAuthenticated, fetchOrders]);

  return { orders, loading, error, actionError, refresh: fetchOrders, approveOrder, rejectOrder };
};
