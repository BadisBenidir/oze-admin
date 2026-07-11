import { supabase } from '../lib/supabase';

class ResellerOrderService {
  async approveOrder(orderId: string): Promise<void> {
    const { error } = await supabase.rpc('approve_b2b_order', { p_order_id: orderId });
    if (error) {
      throw new Error(error.message || "Échec de la validation de la commande");
    }
  }

  async rejectOrder(orderId: string, reason: string): Promise<void> {
    const { error } = await supabase.rpc('reject_b2b_order', { p_order_id: orderId, p_reason: reason || null });
    if (error) {
      throw new Error(error.message || "Échec du rejet de la commande");
    }
  }
}

export const resellerOrderService = new ResellerOrderService();
