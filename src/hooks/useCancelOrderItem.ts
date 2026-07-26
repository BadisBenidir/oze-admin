import { invokeEdgeFunction } from '../utils/invokeEdgeFunction';

export interface CancelOrderItemResult {
  success: boolean;
  error?: string;
  new_total_amount?: number;
  order_status?: string;
  refund_status?: 'not_applicable' | 'succeeded' | 'failed';
  refund_method?: 'wallet' | 'stripe' | null;
  refund_error?: string;
}

export const cancelOrderItem = async (
  orderItemId: string,
  reason: string,
  restockAction: 'draft' | 'for-sale-b2b' | 'archived',
  refundMethod?: 'wallet' | 'stripe'
): Promise<CancelOrderItemResult> => {
  const { data, error } = await invokeEdgeFunction<CancelOrderItemResult>('cancel-b2b-order-item', {
    order_item_id: orderItemId,
    reason,
    restock_action: restockAction,
    refund_method: refundMethod,
  });

  if (error) return { success: false, error };
  return { success: true, ...(data || {}) };
};

export interface CancelOrderResult {
  success: boolean;
  error?: string;
  total_refund?: number;
  refund_status?: 'not_applicable' | 'succeeded' | 'failed';
  refund_method?: 'wallet' | 'stripe' | null;
  refund_error?: string;
}

export const cancelOrder = async (
  orderId: string,
  reason: string,
  restockAction: 'draft' | 'for-sale-b2b' | 'archived',
  refundMethod?: 'wallet' | 'stripe'
): Promise<CancelOrderResult> => {
  const { data, error } = await invokeEdgeFunction<CancelOrderResult>('cancel-b2b-order', {
    order_id: orderId,
    reason,
    restock_action: restockAction,
    refund_method: refundMethod,
  });

  if (error) return { success: false, error };
  return { success: true, ...(data || {}) };
};
