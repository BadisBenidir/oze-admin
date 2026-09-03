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
  entrupy_requested: boolean;
  entrupy_cost: number;
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

export interface B2BOrderRequester {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
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
  /** Profil ayant réellement validé la commande (peut être un sous-compte,
   * pas forcément le contact principal de l'entreprise) — null pour les
   * commandes créées avant l'ajout de placed_by_profile_id (0017). */
  placed_by: B2BOrderRequester | null;
  /** true si placed_by est le contact principal de son entreprise (ou si
   * placed_by_profile_id est inconnu/absent) : dans ce cas, le nom du
   * sous-compte n'apporte rien de plus que reseller.company_name — voir
   * B2BOrders.tsx / B2BOrderDetailModal.tsx pour l'affichage conditionnel. */
  placed_by_is_primary: boolean;
  order_items: B2BOrderItem[];
}

/** Nom/email affichable du sous-compte ayant réellement passé la commande,
 * ou null si inconnu (commande antérieure à placed_by_profile_id) — utilisé
 * par B2BOrders.tsx et B2BOrderDetailModal.tsx pour la ligne en gras
 * au-dessus de reseller.company_name. */
export const getRequesterDisplayName = (order: Pick<B2BOrder, 'placed_by'>): string | null => {
  if (!order.placed_by) return null;
  const fullName = `${order.placed_by.first_name || ''} ${order.placed_by.last_name || ''}`.trim();
  return fullName || order.placed_by.email || null;
};

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
          'id, order_number, status, email, payment_status, stripe_payment_intent_id, placed_by_profile_id, subtotal, shipping_cost, total_amount, shipping_address, created_at, reseller_id, reseller:resellers(company_name), ' +
          'placed_by:profiles!placed_by_profile_id(first_name, last_name, email), ' +
          'order_items(*, shipment_parcel:shipment_parcels(tracking_number,tracking_url,label_url,sendcloud_parcel_id,weight_kg))'
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

      const rows = (data || []) as unknown as (B2BOrder & { placed_by_is_primary?: boolean })[];

      // is_primary se lit par CONTACT (reseller_contacts), pas par commande :
      // une seconde requête ciblée sur les profils réellement rencontrés
      // évite d'avoir à l'embarquer dans le select ci-dessus (aucune relation
      // directe orders -> reseller_contacts). profile_id est unique dans
      // reseller_contacts (voir useB2BCart.ts) : un profil n'appartient
      // jamais qu'à un seul revendeur, donc pas besoin de croiser reseller_id.
      const placedByIds = [...new Set(rows.map((o) => o.placed_by_profile_id).filter((id): id is string => Boolean(id)))];
      let primaryProfileIds = new Set<string>();
      if (placedByIds.length > 0) {
        const { data: contacts, error: contactsError } = await supabase
          .from('reseller_contacts')
          .select('profile_id, is_primary')
          .in('profile_id', placedByIds);
        if (contactsError) throw new Error(contactsError.message);
        primaryProfileIds = new Set((contacts || []).filter((c) => c.is_primary).map((c) => c.profile_id));
      }

      const ordersWithPrimary: B2BOrder[] = rows.map((o) => ({
        ...o,
        // Pas de placed_by_profile_id connu (commandes antérieures à 0017) :
        // traité comme "principal" pour ne pas afficher un sous-titre
        // redondant sans information réelle à montrer.
        placed_by_is_primary: o.placed_by_profile_id ? primaryProfileIds.has(o.placed_by_profile_id) : true,
      }));

      setOrders(ordersWithPrimary);
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
