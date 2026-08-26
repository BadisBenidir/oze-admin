import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export interface B2BShipmentParcel {
  tracking_number: string | null;
  tracking_url: string | null;
  label_url: string | null;
  sendcloud_parcel_id: string | null;
  weight_kg: number | null;
}

export interface B2BOrderItem {
  id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  insured: boolean;
  insurance_cost: number;
  product_snapshot: { name?: string; images?: string[]; main_image_index?: number; product_code?: string; reference?: string | null };
  status: 'active' | 'cancelled';
  cancellation_reason: string | null;
  cancelled_at: string | null;
  restock_action: 'draft' | 'for-sale-b2b' | 'archived' | null;
  refund_status: 'not_applicable' | 'succeeded' | 'failed' | null;
  refund_method: 'wallet' | 'stripe' | null;
  refund_error: string | null;
  is_loyalty_gift: boolean;
  fulfillment_status: 'ordered' | 'received' | 'ready_to_ship' | 'delivery_requested' | 'shipped';
  shipment_id: string | null;
  parcel_id: string | null;
  shipment_parcel: B2BShipmentParcel | null;
}

export interface B2BOrder {
  id: string;
  order_number: string;
  status: string;
  email: string;
  payment_status: string;
  stripe_payment_intent_id: string | null;
  placed_by_profile_id: string | null;
  subtotal: number;
  shipping_cost: number;
  total_amount: number;
  shipping_address: Record<string, unknown>;
  created_at: string;
  reseller_id: string;
  reseller: { company_name: string } | null;
  order_items: B2BOrderItem[];
}

export const useB2BOrders = (isAuthenticated: boolean = false, resellerId?: string, placedByProfileId?: string) => {
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
          'id, order_number, status, email, payment_status, stripe_payment_intent_id, placed_by_profile_id, subtotal, shipping_cost, total_amount, shipping_address, created_at, reseller_id, reseller:resellers(company_name), order_items(*, shipment_parcel:shipment_parcels(tracking_number,tracking_url,label_url,sendcloud_parcel_id,weight_kg))'
        )
        .eq('order_channel', 'b2b');

      if (resellerId) {
        query = query.eq('reseller_id', resellerId);
      }
      // Isole les commandes d'UN sous-compte précis (voir ResellerDetail.tsx,
      // action "Voir les commandes" par contact) plutôt que la vue
      // consolidée de toute l'entreprise.
      if (placedByProfileId) {
        query = query.eq('placed_by_profile_id', placedByProfileId);
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
  }, [resellerId, placedByProfileId]);

  useEffect(() => {
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }
    fetchOrders();
  }, [isAuthenticated, fetchOrders]);

  return { orders, loading, error, refresh: fetchOrders };
};
