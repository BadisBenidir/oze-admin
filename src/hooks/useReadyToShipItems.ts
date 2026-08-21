import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { ChronopostPickupPoint } from '../services/chronopostService';
import { DeliveryType } from '../components/pages/reseller/ShippingForm';
import { invokeEdgeFunction } from '../utils/invokeEdgeFunction';

export interface ReadyToShipItem {
  id: string;
  line_total: number;
  product_id: string;
  shipping_points: number;
  product_snapshot: { name?: string; images?: string[]; main_image_index?: number; product_code?: string } | null;
  order: { order_number: string } | null;
}

interface RequestDeliveryResult {
  success: boolean;
  url?: string;
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
        .select('id, line_total, product_id, product_snapshot, product:products(shipping_points), order:orders!inner(order_number, order_channel)')
        .eq('status', 'active')
        .eq('fulfillment_status', 'ready_to_ship')
        .eq('order.order_channel', 'b2b')
        .order('ready_to_ship_at', { ascending: true });

      if (fetchError) throw new Error(fetchError.message);

      const mapped = ((data || []) as unknown as Array<{ id: string; line_total: number; product_id: string; product_snapshot: ReadyToShipItem['product_snapshot']; product: { shipping_points: number } | null; order: ReadyToShipItem['order'] }>).map((row) => ({
        id: row.id,
        line_total: row.line_total,
        product_id: row.product_id,
        shipping_points: row.product?.shipping_points || 1,
        product_snapshot: row.product_snapshot,
        order: row.order,
      }));

      setItems(mapped);
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

  /**
   * Ne crée plus rien directement : les frais de port sont désormais payants
   * (carte uniquement) — cette fonction ouvre une session Stripe et renvoie
   * son URL de redirection. Le shipment n'est réellement créé qu'après
   * paiement confirmé, via b2b-stripe-webhook + finalize_b2b_delivery_request.
   */
  const requestDelivery = async (
    itemIds: string[],
    deliveryType: DeliveryType,
    parcelPoint: ChronopostPickupPoint | null,
    instructions: string | null
  ): Promise<RequestDeliveryResult> => {
    const { data, error } = await invokeEdgeFunction<{ url?: string }>('b2b-request-delivery-checkout', {
      item_ids: itemIds,
      delivery_type: deliveryType,
      parcel_point: parcelPoint,
      instructions,
    });

    if (error) {
      return { success: false, error };
    }
    if (!data?.url) {
      return { success: false, error: 'Réponse de paiement invalide' };
    }

    return { success: true, url: data.url };
  };

  return { items, loading, error, refresh: fetchItems, requestDelivery };
};
