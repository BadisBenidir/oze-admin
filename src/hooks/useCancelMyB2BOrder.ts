import { invokeEdgeFunction } from '../utils/invokeEdgeFunction';

export interface CancelMyOrderResult {
  success: boolean;
  error?: string;
  order_status?: string;
  cancelled_item_count?: number;
  total_refund?: number;
  refund_status?: 'succeeded' | 'failed';
  refund_error?: string;
}

/**
 * Annulation en libre-service par le revendeur lui-même : `itemIds` omis ou
 * vide annule TOUTE la commande, sinon seulement les articles indiqués.
 * Toujours remboursé en crédit portefeuille (règle fixe côté client, voir
 * cancel-my-b2b-order-item) — aucun choix de méthode ici, contrairement au
 * flux admin.
 */
export const cancelMyOrder = async (
  orderId: string,
  itemIds?: string[]
): Promise<CancelMyOrderResult> => {
  const { data, error } = await invokeEdgeFunction<CancelMyOrderResult>('cancel-my-b2b-order-item', {
    order_id: orderId,
    item_ids: itemIds && itemIds.length > 0 ? itemIds : undefined,
  });

  if (error) return { success: false, error };
  return { success: true, ...(data || {}) };
};
