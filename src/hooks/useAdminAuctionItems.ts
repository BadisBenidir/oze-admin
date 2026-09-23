import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { invokeEdgeFunction } from '../utils/invokeEdgeFunction';

export interface AdminAuctionItem {
  id: string;
  session_id: string;
  title: string;
  brand: string;
  grade: string;
  images: string[];
  start_price: number;
  current_price: number;
  min_increment: number;
  reserve_price: number | null;
  current_winner_id: string | null;
  current_max_amount: number | null;
  winner_name: string | null;
  winner_email: string | null;
  ends_at: string;
  status: 'active' | 'sold' | 'unsold' | 'cancelled';
  product_id: string | null;
  product_name: string | null;
  product_purchase_price: number | null;
  created_at: string;
  order_id: string | null;
  payment_deadline: string | null;
  order_payment_status: 'pending' | 'paid' | null;
  order_has_stripe_payment: boolean;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  refund_status: 'not_applicable' | 'succeeded' | 'failed' | null;
  refund_method: 'wallet' | 'stripe' | null;
  refund_error: string | null;
}

export type AuctionRestockAction = 'draft-b2b' | 'for-sale-b2b' | 'archived';

export interface CancelAuctionItemResult {
  success: boolean;
  error?: string;
  refund_status?: 'not_applicable' | 'succeeded' | 'failed';
  refund_method?: 'wallet' | 'stripe' | null;
  refund_error?: string;
  wallet_refunded?: number;
  stripe_refunded?: number;
}

export interface AuctionItemInput {
  title: string;
  brand: string;
  grade: string;
  images: string[];
  start_price: number;
  min_increment: number;
  reserve_price?: number | null;
}

type Row = Omit<AdminAuctionItem, 'winner_name' | 'winner_email' | 'product_name' | 'product_purchase_price' | 'order_payment_status' | 'order_has_stripe_payment'> & {
  winner: { first_name: string | null; last_name: string | null; email: string | null } | null;
  product: { name: string; purchase_price: number | null } | null;
  order: { payment_status: 'pending' | 'paid'; stripe_payment_intent_id: string | null } | null;
};

const mapRow = (row: Row): AdminAuctionItem => {
  const winnerName = row.winner ? `${row.winner.first_name || ''} ${row.winner.last_name || ''}`.trim() : '';
  return {
    ...row,
    winner_name: winnerName || null,
    winner_email: row.winner?.email || null,
    product_name: row.product?.name || null,
    product_purchase_price: row.product?.purchase_price ?? null,
    order_payment_status: row.order?.payment_status || null,
    order_has_stripe_payment: Boolean(row.order?.stripe_payment_intent_id),
  };
};

/** Lots d'UNE session d'enchères, avec le gagnant actuel résolu (nom/email)
 * et mise à jour temps réel (mêmes conventions Realtime que
 * useAuctionItems.ts côté revendeur : refetch sur événement, pas de lecture
 * du payload). */
export const useAdminAuctionItems = (sessionId: string | null) => {
  const [items, setItems] = useState<AdminAuctionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // AuctionsAdmin.tsx instancie ce hook deux fois en parallèle (onglets
  // "Sessions & Lots" et "Résultats & Facturation") — si les deux pointent
  // sur la même session, un nom de canal basé uniquement sur sessionId
  // collisionne : supabase-js réutilise le canal déjà abonné du premier
  // hook et refuse d'y ajouter les écouteurs du second ("cannot add
  // postgres_changes callbacks ... after subscribe()"). Un suffixe unique
  // par instance de hook évite la collision.
  const instanceId = useRef(Math.random().toString(36).slice(2)).current;

  const fetchItems = useCallback(async () => {
    if (!sessionId) {
      setItems([]);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const { data, error: fetchError } = await supabase
        .from('auction_items')
        .select('*, winner:profiles!current_winner_id(first_name, last_name, email), product:products(name, purchase_price), order:orders(payment_status, stripe_payment_intent_id)')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true });
      if (fetchError) throw new Error(fetchError.message);
      setItems(((data || []) as unknown as Row[]).map(mapRow));
    } catch (err) {
      console.error('Erreur lors du chargement des lots:', err);
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  useEffect(() => {
    if (!sessionId) return;
    const channel = supabase
      .channel(`admin-auction-items-${sessionId}-${instanceId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'auction_items', filter: `session_id=eq.${sessionId}` }, () => fetchItems())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'auction_bids' }, () => fetchItems())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionId, fetchItems]);

  const addItem = async (
    sessionEndsAt: string,
    input: AuctionItemInput,
    productId: string | null = null
  ): Promise<{ success: boolean; error?: string }> => {
    if (!sessionId) return { success: false, error: 'Session inconnue' };
    const { error: insertError } = await supabase.from('auction_items').insert({
      session_id: sessionId,
      title: input.title.trim(),
      brand: input.brand.trim(),
      grade: input.grade,
      images: input.images,
      start_price: input.start_price,
      current_price: input.start_price,
      min_increment: input.min_increment,
      reserve_price: input.reserve_price ?? null,
      ends_at: sessionEndsAt,
      product_id: productId,
    });
    if (insertError) return { success: false, error: insertError.message };
    await fetchItems();
    return { success: true };
  };

  const removeItem = async (id: string): Promise<{ success: boolean; error?: string }> => {
    const { error: deleteError } = await supabase.from('auction_items').delete().eq('id', id);
    if (deleteError) return { success: false, error: deleteError.message };
    await fetchItems();
    return { success: true };
  };

  const updateStartPrice = async (id: string, startPrice: number): Promise<{ success: boolean; error?: string }> => {
    // Le prix de départ ne peut plus être changé une fois une enchère posée
    // (current_price aurait déjà divergé) — le formulaire n'expose ce bouton
    // que pour un lot encore à son prix de départ.
    const { error: updateError } = await supabase
      .from('auction_items')
      .update({ start_price: startPrice, current_price: startPrice })
      .eq('id', id);
    if (updateError) return { success: false, error: updateError.message };
    await fetchItems();
    return { success: true };
  };

  const linkProduct = async (id: string, productId: string | null): Promise<{ success: boolean; error?: string }> => {
    const { error: updateError } = await supabase.from('auction_items').update({ product_id: productId }).eq('id', id);
    if (updateError) return { success: false, error: updateError.message };
    await fetchItems();
    return { success: true };
  };

  const generateOrder = async (id: string): Promise<{ success: boolean; error?: string; orderNumber?: string }> => {
    const { data, error: rpcError } = await supabase.rpc('admin_generate_order_from_auction_item', { p_item_id: id });
    if (rpcError) return { success: false, error: rpcError.message };
    await fetchItems();
    return { success: true, orderNumber: (data as { order_number?: string } | null)?.order_number };
  };

  /** Annule un lot adjugé (admin uniquement, Edge Function cancel-auction-item)
   * et rembourse s'il était payé — voir 0156. */
  const cancelItem = async (
    id: string,
    reason: string,
    restockAction: AuctionRestockAction,
    refundMethod?: 'wallet' | 'stripe'
  ): Promise<CancelAuctionItemResult> => {
    const { data, error: fnError } = await invokeEdgeFunction<CancelAuctionItemResult>('cancel-auction-item', {
      item_id: id,
      reason,
      restock_action: restockAction,
      refund_method: refundMethod,
    });
    if (fnError) return { success: false, error: fnError };
    await fetchItems();
    return { success: true, ...(data || {}) };
  };

  return { items, loading, error, refresh: fetchItems, addItem, removeItem, updateStartPrice, linkProduct, generateOrder, cancelItem };
};
