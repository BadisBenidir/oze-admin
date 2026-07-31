import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { ChronopostPickupPoint } from '../services/chronopostService';
import { DeliveryType } from '../components/pages/reseller/ShippingForm';

export interface DeliveryBatch {
  id: string;
  reseller_id: string;
  status: 'open' | 'delivery_available' | 'requested' | 'shipped' | 'cancelled';
  delivery_available_at: string | null;
  requested_at: string | null;
  delivery_type: DeliveryType | null;
  parcel_point: ChronopostPickupPoint | null;
  delivery_instructions: string | null;
  created_at: string;
}

interface RequestDeliveryResult {
  success: boolean;
  error?: string;
}

/**
 * Lots de livraison du revendeur connecté (voir 0054_delivery_batches.sql) :
 * regroupe automatiquement ses commandes B2B non expédiées. Le bouton
 * "Demander la livraison" (côté UI) n'est actif que pour un lot au statut
 * 'delivery_available' (flag posé par un admin, voir useAdminDeliveryBatches
 * côté B2BOrders.tsx).
 */
export const useDeliveryBatches = (isAuthenticated: boolean = false) => {
  const [batches, setBatches] = useState<DeliveryBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBatches = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from('delivery_batches')
        .select('id, reseller_id, status, delivery_available_at, requested_at, delivery_type, parcel_point, delivery_instructions, created_at')
        .order('created_at', { ascending: false });

      if (fetchError) {
        throw new Error(fetchError.message);
      }

      setBatches((data || []) as DeliveryBatch[]);
    } catch (err) {
      console.error('Erreur lors du chargement des lots de livraison:', err);
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
    fetchBatches();
  }, [isAuthenticated, fetchBatches]);

  const requestDelivery = async (
    batchId: string,
    deliveryType: DeliveryType,
    parcelPoint: ChronopostPickupPoint | null,
    instructions: string | null
  ): Promise<RequestDeliveryResult> => {
    const { error: rpcError } = await supabase.rpc('request_batch_delivery', {
      p_batch_id: batchId,
      p_delivery_type: deliveryType,
      p_parcel_point: parcelPoint,
      p_instructions: instructions,
    });

    if (rpcError) {
      return { success: false, error: rpcError.message };
    }

    await fetchBatches();
    return { success: true };
  };

  return { batches, loading, error, refresh: fetchBatches, requestDelivery };
};
