import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export interface AdminShipmentItem {
  id: string;
  line_total: number;
  insured: boolean;
  insurance_cost: number;
  fulfillment_status: string;
  product_snapshot: { name?: string; images?: string[]; main_image_index?: number; product_code?: string; weight?: number } | null;
}

export interface AdminShipmentParcel {
  id: string;
  parcel_index: number;
  status: 'pending' | 'shipped' | 'failed';
  sendcloud_parcel_id: string | null;
  tracking_number: string | null;
  tracking_url: string | null;
  label_url: string | null;
  weight_kg: number | null;
  error_message: string | null;
}

export interface AdminShipment {
  id: string;
  reseller_id: string;
  companyName: string;
  requested_at: string;
  delivery_type: 'domicile' | 'point_relais';
  parcel_point: Record<string, unknown> | null;
  delivery_instructions: string | null;
  status: 'requested' | 'partially_shipped' | 'shipped';
  pendingItems: AdminShipmentItem[];
  parcels: AdminShipmentParcel[];
}

/**
 * Demandes de livraison B2B en attente de traitement (voir
 * reseller_request_item_delivery, 0063_shipment_fulfillment_rpcs.sql) — pour
 * chaque shipment 'requested'/'partially_shipped', les articles encore
 * delivery_requested et les colis déjà tentés (succès ou échec).
 */
export const useAdminShipments = (isAuthenticated: boolean = false) => {
  const [shipments, setShipments] = useState<AdminShipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchShipments = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const { data: shipmentRows, error: shipmentsError } = await supabase
        .from('shipments')
        .select('id, reseller_id, requested_at, delivery_type, parcel_point, delivery_instructions, status, reseller:resellers(company_name)')
        .in('status', ['requested', 'partially_shipped'])
        .order('requested_at', { ascending: true });
      if (shipmentsError) throw new Error(shipmentsError.message);

      const shipmentIds = (shipmentRows || []).map((s) => s.id);
      if (shipmentIds.length === 0) {
        setShipments([]);
        return;
      }

      const [{ data: itemRows, error: itemsError }, { data: parcelRows, error: parcelsError }] = await Promise.all([
        supabase
          .from('order_items')
          .select('id, line_total, insured, insurance_cost, fulfillment_status, product_snapshot, shipment_id')
          .in('shipment_id', shipmentIds)
          .eq('fulfillment_status', 'delivery_requested'),
        supabase
          .from('shipment_parcels')
          .select('id, shipment_id, parcel_index, status, sendcloud_parcel_id, tracking_number, tracking_url, label_url, weight_kg, error_message')
          .in('shipment_id', shipmentIds)
          .order('parcel_index', { ascending: true }),
      ]);
      if (itemsError) throw new Error(itemsError.message);
      if (parcelsError) throw new Error(parcelsError.message);

      const itemsByShipment = new Map<string, AdminShipmentItem[]>();
      for (const row of (itemRows || []) as Array<AdminShipmentItem & { shipment_id: string }>) {
        const list = itemsByShipment.get(row.shipment_id) || [];
        list.push(row);
        itemsByShipment.set(row.shipment_id, list);
      }
      const parcelsByShipment = new Map<string, AdminShipmentParcel[]>();
      for (const row of (parcelRows || []) as Array<AdminShipmentParcel & { shipment_id: string }>) {
        const list = parcelsByShipment.get(row.shipment_id) || [];
        list.push(row);
        parcelsByShipment.set(row.shipment_id, list);
      }

      setShipments(
        (shipmentRows || []).map((s) => ({
          id: s.id,
          reseller_id: s.reseller_id,
          companyName: (s.reseller as unknown as { company_name: string } | null)?.company_name || 'Revendeur',
          requested_at: s.requested_at,
          delivery_type: s.delivery_type,
          parcel_point: s.parcel_point,
          delivery_instructions: s.delivery_instructions,
          status: s.status,
          pendingItems: itemsByShipment.get(s.id) || [],
          parcels: parcelsByShipment.get(s.id) || [],
        }))
      );
    } catch (err) {
      console.error('Erreur lors du chargement des demandes de livraison:', err);
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
    fetchShipments();
  }, [isAuthenticated, fetchShipments]);

  return { shipments, loading, error, refresh: fetchShipments };
};
