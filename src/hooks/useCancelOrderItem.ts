import { invokeEdgeFunction } from '../utils/invokeEdgeFunction';

export interface CancelOrderItemResult {
  success: boolean;
  error?: string;
  new_total_amount?: number;
  order_status?: string;
  refund_status?: 'not_applicable' | 'succeeded' | 'failed';
  refund_error?: string;
}

export const cancelOrderItem = async (
  orderItemId: string,
  reason: string,
  restockAction: 'draft' | 'for-sale-b2b' | 'archived'
): Promise<CancelOrderItemResult> => {
  const { data, error } = await invokeEdgeFunction<CancelOrderItemResult>('cancel-b2b-order-item', {
    order_item_id: orderItemId,
    reason,
    restock_action: restockAction,
  });

  if (error) return { success: false, error };
  return { success: true, ...(data || {}) };
};
