import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export interface AdminDeliveryBatch {
  id: string;
  reseller_id: string;
  reseller: { company_name: string } | null;
  status: 'open' | 'delivery_available' | 'requested' | 'shipped' | 'cancelled';
  delivery_available_at: string | null;
  requested_at: string | null;
  delivery_type: 'domicile' | 'point_relais' | null;
  parcel_point: Record<string, unknown> | null;
  delivery_instructions: string | null;
  created_at: string;
}

interface MarkAvailableResult {
  success: boolean;
  error?: string;
}

/**
 * Vue admin des lots de livraison B2B (voir 0054_delivery_batches.sql) : tous
 * revendeurs confondus, is_admin() donne accès à l'intégralité de la table.
 */
export const useAdminDeliveryBatches = (isAuthenticated: boolean = false) => {
  const [batches, setBatches] = useState<AdminDeliveryBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBatches = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from('delivery_batches')
        .select('id, reseller_id, reseller:resellers(company_name), status, delivery_available_at, requested_at, delivery_type, parcel_point, delivery_instructions, created_at')
        .order('created_at', { ascending: false });

      if (fetchError) {
        throw new Error(fetchError.message);
      }

      setBatches((data || []) as unknown as AdminDeliveryBatch[]);
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

  const markDeliveryAvailable = async (batchId: string): Promise<MarkAvailableResult> => {
    const { error: rpcError } = await supabase.rpc('admin_mark_delivery_available', { p_batch_id: batchId });
    if (rpcError) {
      return { success: false, error: rpcError.message };
    }
    await fetchBatches();
    return { success: true };
  };

  return { batches, loading, error, refresh: fetchBatches, markDeliveryAvailable };
};
