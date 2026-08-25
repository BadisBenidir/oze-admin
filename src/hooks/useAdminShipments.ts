import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export interface AdminShipmentItem {
  id: string;
  line_total: number;
  insured: boolean;
  insurance_cost: number;
  fulfillment_status: string;
  product_id: string;
  product: {
    name: string;
    images: string[];
    main_image_index: number;
    product_code: string | null;
    reference: string | null;
    b2b_reference: string | null;
    condition: string | null;
    sale_price: number;
    brand: { name: string } | null;
  } | null;
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

export interface AdminShipmentRequester {
  fullName: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  country: string | null;
}

export interface AdminShipment {
  id: string;
  reseller_id: string;
  companyName: string;
  requester: AdminShipmentRequester;
  requested_at: string;
  delivery_type: 'domicile' | 'point_relais';
  parcel_point: Record<string, unknown> | null;
  delivery_instructions: string | null;
  status: 'requested' | 'partially_shipped' | 'shipped';
  pendingItems: AdminShipmentItem[];
  shippedItems: AdminShipmentItem[];
  parcels: AdminShipmentParcel[];
}

const DEFAULT_STATUSES: AdminShipment['status'][] = ['requested', 'partially_shipped'];

/**
 * Demandes de livraison B2B (voir finalize_b2b_delivery_request,
 * 0065_paid_delivery_schema_and_rpc.sql), filtrées par statut de shipment
 * (`statuses`, par défaut la file "en attente d'expédition") — qui l'a
 * demandé (le sous-compte réel, pas seulement le revendeur), son adresse
 * (domicile — point_relais est déjà dans parcel_point), les articles encore
 * à préparer (pendingItems, données produit LIVE) et ceux déjà expédiés
 * (shippedItems, pour l'historique/réimpression même une fois le shipment
 * passé au statut 'shipped' — voir ShipmentDetailModal).
 */
export const useAdminShipments = (isAuthenticated: boolean = false, statuses: AdminShipment['status'][] = DEFAULT_STATUSES) => {
  const [shipments, setShipments] = useState<AdminShipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const statusesKey = statuses.join(',');

  const fetchShipments = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const { data: shipmentRows, error: shipmentsError } = await supabase
        .from('shipments')
        .select(
          'id, reseller_id, requested_at, delivery_type, parcel_point, delivery_instructions, status, ' +
          'reseller:resellers(company_name), ' +
          'requester:profiles(first_name, last_name, email, phone, address, city, postal_code, country)'
        )
        .in('status', statusesKey.split(','))
        .order('requested_at', { ascending: !statuses.includes('shipped') });
      if (shipmentsError) throw new Error(shipmentsError.message);

      type ShipmentRow = {
        id: string;
        reseller_id: string;
        requested_at: string;
        delivery_type: 'domicile' | 'point_relais';
        parcel_point: Record<string, unknown> | null;
        delivery_instructions: string | null;
        status: 'requested' | 'partially_shipped' | 'shipped';
        reseller: { company_name: string } | null;
        requester: {
          first_name: string | null; last_name: string | null; email: string | null; phone: string | null;
          address: string | null; city: string | null; postal_code: string | null; country: string | null;
        } | null;
      };
      const shipmentRowsTyped = (shipmentRows || []) as unknown as ShipmentRow[];

      const shipmentIds = shipmentRowsTyped.map((s) => s.id);
      if (shipmentIds.length === 0) {
        setShipments([]);
        return;
      }

      // Aucun filtre de statut sur les articles : on récupère tout le contenu
      // du shipment (encore à préparer OU déjà expédié) puis on répartit
      // ci-dessous — nécessaire pour l'onglet historique (ShipmentDetailModal
      // doit pouvoir montrer les pièces déjà envoyées + réimprimer leur
      // étiquette même une fois le shipment passé au statut 'shipped').
      const [{ data: itemRows, error: itemsError }, { data: parcelRows, error: parcelsError }] = await Promise.all([
        supabase
          .from('order_items')
          .select(
            'id, line_total, insured, insurance_cost, fulfillment_status, product_id, shipment_id, ' +
            'product:products(name, images, main_image_index, product_code, reference, b2b_reference, condition, sale_price, brand:brands(name))'
          )
          .in('shipment_id', shipmentIds),
        supabase
          .from('shipment_parcels')
          .select('id, shipment_id, parcel_index, status, sendcloud_parcel_id, tracking_number, tracking_url, label_url, weight_kg, error_message')
          .in('shipment_id', shipmentIds)
          .order('parcel_index', { ascending: true }),
      ]);
      if (itemsError) throw new Error(itemsError.message);
      if (parcelsError) throw new Error(parcelsError.message);

      const pendingByShipment = new Map<string, AdminShipmentItem[]>();
      const shippedByShipment = new Map<string, AdminShipmentItem[]>();
      for (const row of (itemRows || []) as unknown as Array<AdminShipmentItem & { shipment_id: string }>) {
        const target = row.fulfillment_status === 'shipped' ? shippedByShipment : pendingByShipment;
        const list = target.get(row.shipment_id) || [];
        list.push(row);
        target.set(row.shipment_id, list);
      }
      const parcelsByShipment = new Map<string, AdminShipmentParcel[]>();
      for (const row of (parcelRows || []) as Array<AdminShipmentParcel & { shipment_id: string }>) {
        const list = parcelsByShipment.get(row.shipment_id) || [];
        list.push(row);
        parcelsByShipment.set(row.shipment_id, list);
      }

      setShipments(
        shipmentRowsTyped.map((s) => {
          const requester = s.requester;
          const fullName = `${requester?.first_name || ''} ${requester?.last_name || ''}`.trim() || 'Utilisateur inconnu';
          return {
            id: s.id,
            reseller_id: s.reseller_id,
            companyName: s.reseller?.company_name || 'Revendeur',
            requester: {
              fullName,
              email: requester?.email || null,
              phone: requester?.phone || null,
              address: requester?.address || null,
              city: requester?.city || null,
              postalCode: requester?.postal_code || null,
              country: requester?.country || null,
            },
            requested_at: s.requested_at,
            delivery_type: s.delivery_type,
            parcel_point: s.parcel_point,
            delivery_instructions: s.delivery_instructions,
            status: s.status,
            pendingItems: pendingByShipment.get(s.id) || [],
            shippedItems: shippedByShipment.get(s.id) || [],
            parcels: parcelsByShipment.get(s.id) || [],
          };
        })
      );
    } catch (err) {
      console.error('Erreur lors du chargement des demandes de livraison:', err);
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }, [statusesKey]);

  useEffect(() => {
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }
    fetchShipments();
  }, [isAuthenticated, fetchShipments]);

  return { shipments, loading, error, refresh: fetchShipments };
};
