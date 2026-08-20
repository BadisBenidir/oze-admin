import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { ChronopostPickupPoint } from '../services/chronopostService';
import { DeliveryType } from '../components/pages/reseller/ShippingForm';

export interface ReadyToShipItem {
  id: string;
  line_total: number;
  product_snapshot: { name?: string; images?: string[]; main_image_index?: number; product_code?: string } | null;
  order: { order_number: string } | null;
}

interface RequestDeliveryResult {
  success: boolean;
  error?: string;
}

/**
 * Articles B2B au statut ready_to_ship du revendeur connecté — portée à
 * TOUTE l'entreprise (RLS via current_reseller_id(), pas juste le profil
 * courant), même logique que l'ancien delivery_batches. Voir
 * 0063_shipment_fulfillment_rpcs.sql.
 */
export const useReadyToShipItems = (isAuthenticated: boolean = false) => {
  const [items, setItems] = useState<ReadyToShipItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchItems = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from('order_items')
        .select('id, line_total, product_snapshot, order:orders!inner(order_number, order_channel)')
        .eq('status', 'active')
        .eq('fulfillment_status', 'ready_to_ship')
        .eq('order.order_channel', 'b2b')
        .order('ready_to_ship_at', { ascending: true });

      if (fetchError) throw new Error(fetchError.message);

      setItems((data || []) as unknown as ReadyToShipItem[]);
    } catch (err) {
      console.error('Erreur lors du chargement des articles prêts à être expédiés:', err);
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
    fetchItems();
  }, [isAuthenticated, fetchItems]);

  const requestDelivery = async (
    itemIds: string[],
    deliveryType: DeliveryType,
    parcelPoint: ChronopostPickupPoint | null,
    instructions: string | null
  ): Promise<RequestDeliveryResult> => {
    const { error: rpcError } = await supabase.rpc('reseller_request_item_delivery', {
      p_item_ids: itemIds,
      p_delivery_type: deliveryType,
      p_parcel_point: parcelPoint,
      p_instructions: instructions,
    });

    if (rpcError) {
      return { success: false, error: rpcError.message };
    }

    await fetchItems();
    return { success: true };
  };

  return { items, loading, error, refresh: fetchItems, requestDelivery };
};
