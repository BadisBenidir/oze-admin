import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export interface ProductSaleDetails {
  orderItemId: string;
  orderItemStatus: 'active' | 'cancelled';
  fulfillmentStatus: 'ordered' | 'received' | 'ready_to_ship' | 'delivery_requested' | 'label_created' | 'shipped' | 'delivered';
  order: {
    id: string;
    orderNumber: string;
    createdAt: string;
    companyName: string | null;
  };
  /** Sous-compte ayant réellement passé la commande — null si inconnu
   * (commande antérieure à placed_by_profile_id, voir 0017). */
  requesterName: string | null;
  /** true si le requérant est le contact principal de l'entreprise (ou si
   * inconnu) : dans ce cas, requesterName n'apporte rien de plus que
   * companyName — voir ProductSaleDetails.tsx pour l'affichage conditionnel. */
  requesterIsPrimary: boolean;
  parcel: {
    parcelIndex: number;
    trackingNumber: string | null;
    trackingUrl: string | null;
    labelUrl: string | null;
  } | null;
}

/**
 * Détails de la vente B2B d'UN produit précis, retrouvés via
 * products.reserved_by_order_id (posé à la vente par confirm_b2b_payment /
 * pay_b2b_order_with_wallet / admin_record_direct_b2b_sale — le lien
 * fiable, plutôt que de deviner via order_items.status = 'active') : la
 * commande, le sous-compte réel qui l'a passée, et le colis déjà rattaché
 * s'il y en a un. Retourne null tant que reserved_by_order_id est vide
 * (produit jamais vendu) ou si aucun order_item ne correspond (donnée
 * incohérente/historique).
 */
export const useProductSaleDetails = (productId: string | undefined, reservedByOrderId: string | null | undefined) => {
  const [details, setDetails] = useState<ProductSaleDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDetails = useCallback(async () => {
    if (!productId || !reservedByOrderId) {
      setDetails(null);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from('order_items')
        .select(
          'id, status, fulfillment_status, ' +
          'shipment_parcel:shipment_parcels(parcel_index, tracking_number, tracking_url, label_url), ' +
          'order:orders(id, order_number, created_at, placed_by_profile_id, reseller:resellers(company_name), placed_by:profiles!placed_by_profile_id(first_name, last_name, email))'
        )
        .eq('order_id', reservedByOrderId)
        .eq('product_id', productId)
        .maybeSingle();

      if (fetchError) throw new Error(fetchError.message);
      if (!data) {
        setDetails(null);
        return;
      }

      const row = data as unknown as {
        id: string;
        status: 'active' | 'cancelled';
        fulfillment_status: ProductSaleDetails['fulfillmentStatus'];
        shipment_parcel: { parcel_index: number; tracking_number: string | null; tracking_url: string | null; label_url: string | null } | null;
        order: {
          id: string;
          order_number: string;
          created_at: string;
          placed_by_profile_id: string | null;
          reseller: { company_name: string } | null;
          placed_by: { first_name: string | null; last_name: string | null; email: string | null } | null;
        };
      };

      let requesterIsPrimary = true;
      if (row.order.placed_by_profile_id) {
        const { data: contact } = await supabase
          .from('reseller_contacts')
          .select('is_primary')
          .eq('profile_id', row.order.placed_by_profile_id)
          .maybeSingle();
        requesterIsPrimary = contact?.is_primary !== false;
      }

      const requesterName = row.order.placed_by
        ? `${row.order.placed_by.first_name || ''} ${row.order.placed_by.last_name || ''}`.trim() || row.order.placed_by.email || null
        : null;

      setDetails({
        orderItemId: row.id,
        orderItemStatus: row.status,
        fulfillmentStatus: row.fulfillment_status,
        order: {
          id: row.order.id,
          orderNumber: row.order.order_number,
          createdAt: row.order.created_at,
          companyName: row.order.reseller?.company_name || null,
        },
        requesterName,
        requesterIsPrimary,
        parcel: row.shipment_parcel
          ? {
              parcelIndex: row.shipment_parcel.parcel_index,
              trackingNumber: row.shipment_parcel.tracking_number,
              trackingUrl: row.shipment_parcel.tracking_url,
              labelUrl: row.shipment_parcel.label_url,
            }
          : null,
      });
    } catch (err) {
      console.error('Erreur lors du chargement des détails de la vente:', err);
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }, [productId, reservedByOrderId]);

  useEffect(() => {
    fetchDetails();
  }, [fetchDetails]);

  return { details, loading, error, refresh: fetchDetails };
};
