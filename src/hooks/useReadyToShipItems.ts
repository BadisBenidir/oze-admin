import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { ChronopostPickupPoint } from '../services/chronopostService';
import { DeliveryType } from '../components/pages/reseller/ShippingForm';
import { invokeEdgeFunction } from '../utils/invokeEdgeFunction';
import { useResellerAuth } from './useResellerAuth';

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
 * Articles B2B au statut ready_to_ship visibles par le profil connecté —
 * STRICTEMENT les siens (placed_by_profile_id = profile.id), y compris pour
 * le contact principal de l'entreprise. Décision produit explicite : cette
 * liste sert à demander SA PROPRE livraison, pas à superviser celle de
 * l'équipe (contrairement à Suivi livraisons / Team.tsx, qui gardent
 * l'élargissement "contact principal voit toute l'entreprise" autorisé par
 * la policy RLS order_items_reseller_select_own — cette policy RLS n'est
 * volontairement PAS resserrée ici : elle reste le plafond de ce qui est
 * légalement accessible, cette requête choisit délibérément de demander
 * moins que ce plafond pour cet écran précis).
 */
export const useReadyToShipItems = (isAuthenticated: boolean = false) => {
  const { profile } = useResellerAuth();
  const [items, setItems] = useState<ReadyToShipItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchItems = useCallback(async () => {
    if (!profile) {
      setItems([]);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);

      const query = supabase
        .from('order_items')
        .select(
          'id, line_total, product_id, product_snapshot, product:products(shipping_points), order:orders!inner(order_number, order_channel, reseller_id, placed_by_profile_id)'
        )
        .eq('status', 'active')
        .eq('fulfillment_status', 'ready_to_ship')
        .eq('order.order_channel', 'b2b')
        .eq('order.placed_by_profile_id', profile.id);

      const { data, error: fetchError } = await query.order('ready_to_ship_at', { ascending: true });

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
  }, [profile]);

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
