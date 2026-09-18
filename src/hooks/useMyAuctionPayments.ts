import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { invokeEdgeFunction } from '../utils/invokeEdgeFunction';

export interface PendingAuctionPayment {
  item_id: string;
  title: string;
  brand: string;
  images: string[];
  order_id: string;
  order_number: string;
  amount: number;
  payment_deadline: string | null;
}

export interface PayAuctionResult {
  success: boolean;
  error?: string;
  /** Renseigné uniquement pour un paiement carte : redirige vers Stripe. */
  redirectUrl?: string;
}

/**
 * Lots d'enchère remportés par le profil connecté, dont la commande générée
 * à la clôture (admin_close_auction_session, 0137) n'est pas encore payée —
 * affiché dans un espace dédié de la page Enchères (voir AuctionPaymentsDue).
 */
export const useMyAuctionPayments = (enabled: boolean) => {
  const [payments, setPayments] = useState<PendingAuctionPayment[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPayments = useCallback(async () => {
    if (!enabled) {
      setPayments([]);
      setLoading(false);
      return;
    }
    const { data, error } = await supabase.rpc('get_my_pending_auction_payments');
    if (error) {
      console.error('Erreur lors du chargement des paiements d\'enchère en attente:', error);
      setLoading(false);
      return;
    }
    setPayments((data || []) as PendingAuctionPayment[]);
    setLoading(false);
  }, [enabled]);

  useEffect(() => {
    fetchPayments();
  }, [fetchPayments]);

  useEffect(() => {
    if (!enabled) return;
    const channel = supabase
      .channel('my-auction-payments')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'auction_items' }, () => fetchPayments())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, () => fetchPayments())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, fetchPayments]);

  const pay = async (orderId: string, paymentMethod: 'wallet' | 'card'): Promise<PayAuctionResult> => {
    const { data, error } = await invokeEdgeFunction<{ url?: string; success?: boolean }>('auction-order-payment', {
      order_id: orderId,
      payment_method: paymentMethod,
    });
    if (error) return { success: false, error };
    if (data?.url) return { success: true, redirectUrl: data.url };
    await fetchPayments();
    return { success: true };
  };

  return { payments, loading, refresh: fetchPayments, pay };
};
