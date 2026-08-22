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
 * Expéditions du revendeur connecté (toute l'entreprise — un shipment
 * regroupe des articles demandés par n'importe quel membre de l'équipe,
 * donc visible par toute l'équipe, pas seulement son auteur). Filtre
 * explicite en défense en profondeur en plus de la policy RLS
 * (reseller_id = current_reseller_id()) : ne pas dépendre uniquement de RLS,
 * surtout après la fuite corrigée en 0075 sur orders/order_items.
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

      const { data: shipmentRows, error: shipmentsError } = await supabase
        .from('shipments')
        .select('id, status, delivery_type, parcel_point, delivery_instructions, shipping_cost, requested_at')
        .eq('reseller_id', profile.reseller_id)
        .order('requested_at', { ascending: false });
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
        supabase.from('order_items').select('id, shipment_id').in('shipment_id', shipmentIds),
      ]);
      if (parcelsError) throw new Error(parcelsError.message);
      if (itemsError) throw new Error(itemsError.message);

      const parcelsByShipment = new Map<string, MyShipmentParcel[]>();
      for (const row of (parcelRows || []) as Array<MyShipmentParcel & { shipment_id: string }>) {
        const list = parcelsByShipment.get(row.shipment_id) || [];
        list.push(row);
        parcelsByShipment.set(row.shipment_id, list);
      }
      const countByShipment = new Map<string, number>();
      for (const row of (itemRows || []) as Array<{ shipment_id: string }>) {
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
