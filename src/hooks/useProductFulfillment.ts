import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export type ProductFulfillmentStatus =
  | 'ordered'
  | 'received'
  | 'ready_to_ship'
  | 'delivery_requested'
  | 'label_created'
  | 'shipped'
  | 'delivered';

/**
 * Étape de réception / livraison des articles vendus en B2B (order_items
 * actifs, voir 0062/0063) — affichée à côté de « Vendu (B2B) » dans la liste
 * Produits pour vérifier d'un coup d'œil qu'un arrivage est bien traité.
 * Une requête groupée par page (jamais une par ligne). Un id absent de la
 * map = article vendu sans commande (mission de sourcing clôturée avant 0197).
 */
export const useProductFulfillment = (productIds: string[]) => {
  const [statuses, setStatuses] = useState<Record<string, ProductFulfillmentStatus>>({});
  const key = productIds.slice().sort().join(',');

  useEffect(() => {
    if (!key) {
      setStatuses({});
      return;
    }
    let cancelled = false;
    supabase
      .from('order_items')
      .select('product_id, fulfillment_status')
      .in('product_id', key.split(','))
      .eq('status', 'active')
      .then(({ data, error }) => {
        if (cancelled || error) return;
        const next: Record<string, ProductFulfillmentStatus> = {};
        for (const row of data || []) {
          if (row.product_id) next[row.product_id] = row.fulfillment_status as ProductFulfillmentStatus;
        }
        setStatuses(next);
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return statuses;
};

export const FULFILLMENT_LABELS: Record<ProductFulfillmentStatus, { label: string; variant: 'default' | 'info' | 'success' | 'warning' | 'purple' }> = {
  ordered: { label: 'Non reçu', variant: 'default' },
  received: { label: 'Reçu', variant: 'info' },
  ready_to_ship: { label: 'Prêt à la livraison', variant: 'success' },
  delivery_requested: { label: 'Livraison demandée', variant: 'purple' },
  label_created: { label: 'En préparation', variant: 'warning' },
  shipped: { label: 'Expédié', variant: 'info' },
  delivered: { label: 'Livré', variant: 'success' },
};
