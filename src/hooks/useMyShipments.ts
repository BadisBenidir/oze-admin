import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useResellerAuth } from './useResellerAuth';

export interface MyShipmentParcel {
  id: string;
  parcel_index: number;
  status: 'pending' | 'shipped' | 'failed';
  tracking_number: string | null;
  tracking_url: string | null;
  label_url: string | null;
  weight_kg: number | null;
  /** Noms des articles effectivement rattachés à CE colis (order_items.parcel_id) —
   * absent/vide pour un colis encore 'pending' (les articles n'ont pas
   * encore de parcel_id tant que l'étiquette n'est pas générée). */
  itemNames: string[];
}

export interface MyShipment {
  id: string;
  status: 'requested' | 'partially_shipped' | 'shipped';
  delivery_type: 'domicile' | 'point_relais';
  parcel_point: Record<string, unknown> | null;
  delivery_instructions: string | null;
  shipping_cost: number;
  requested_at: string;
  parcels: MyShipmentParcel[];
  itemCount: number;
}

/**
 * Expéditions visibles par le profil connecté : ses propres demandes de
 * livraison toujours (requested_by_profile_id = auth.uid()), et — s'il est
 * le contact principal de son entreprise — celles de toute l'équipe (même
 * règle que orders/order_items, voir 0017 et 0079_lock_down_shipment_rls).
 * Filtre explicite en défense en profondeur en plus de la policy RLS : ne
 * pas dépendre uniquement de RLS, surtout après la fuite corrigée en 0075.
 */
export const useMyShipments = (isAuthenticated: boolean = false) => {
  const { profile } = useResellerAuth();
  const [shipments, setShipments] = useState<MyShipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchShipments = useCallback(async () => {
    if (!profile) {
      setShipments([]);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);

      let query = supabase
        .from('shipments')
        .select('id, status, delivery_type, parcel_point, delivery_instructions, shipping_cost, requested_at, requested_by_profile_id')
        .eq('reseller_id', profile.reseller_id);

      query = profile.is_primary ? query : query.eq('requested_by_profile_id', profile.id);

      const { data: shipmentRows, error: shipmentsError } = await query.order('requested_at', { ascending: false });
      if (shipmentsError) throw new Error(shipmentsError.message);

      const shipmentIds = (shipmentRows || []).map((s) => s.id);
      if (shipmentIds.length === 0) {
        setShipments([]);
        return;
      }

      const [{ data: parcelRows, error: parcelsError }, { data: itemRows, error: itemsError }] = await Promise.all([
        supabase
          .from('shipment_parcels')
          .select('id, shipment_id, parcel_index, status, tracking_number, tracking_url, label_url, weight_kg')
          .in('shipment_id', shipmentIds)
          .order('parcel_index', { ascending: true }),
        supabase.from('order_items').select('id, shipment_id, parcel_id, product_snapshot').in('shipment_id', shipmentIds),
      ]);
      if (parcelsError) throw new Error(parcelsError.message);
      if (itemsError) throw new Error(itemsError.message);

      const itemRowsTyped = (itemRows || []) as Array<{ shipment_id: string; parcel_id: string | null; product_snapshot: { name?: string } | null }>;

      const namesByParcel = new Map<string, string[]>();
      for (const row of itemRowsTyped) {
        if (!row.parcel_id) continue;
        const list = namesByParcel.get(row.parcel_id) || [];
        list.push(row.product_snapshot?.name || 'Article');
        namesByParcel.set(row.parcel_id, list);
      }

      const parcelsByShipment = new Map<string, MyShipmentParcel[]>();
      for (const row of (parcelRows || []) as Array<Omit<MyShipmentParcel, 'itemNames'> & { shipment_id: string }>) {
        const list = parcelsByShipment.get(row.shipment_id) || [];
        list.push({ ...row, itemNames: namesByParcel.get(row.id) || [] });
        parcelsByShipment.set(row.shipment_id, list);
      }
      const countByShipment = new Map<string, number>();
      for (const row of itemRowsTyped) {
        countByShipment.set(row.shipment_id, (countByShipment.get(row.shipment_id) || 0) + 1);
      }

      setShipments(
        (shipmentRows || []).map((s) => ({
          ...s,
          parcels: parcelsByShipment.get(s.id) || [],
          itemCount: countByShipment.get(s.id) || 0,
        }))
      );
    } catch (err) {
      console.error('Erreur lors du chargement des expéditions:', err);
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
    fetchShipments();
  }, [isAuthenticated, fetchShipments]);

  return { shipments, loading, error, refresh: fetchShipments };
};
