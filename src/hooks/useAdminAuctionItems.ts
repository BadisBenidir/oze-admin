import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

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
  winner_name: string | null;
  winner_email: string | null;
  ends_at: string;
  status: 'active' | 'sold' | 'unsold';
  product_id: string | null;
  product_name: string | null;
  created_at: string;
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

type Row = Omit<AdminAuctionItem, 'winner_name' | 'winner_email' | 'product_name'> & {
  winner: { first_name: string | null; last_name: string | null; email: string | null } | null;
  product: { name: string } | null;
};

const mapRow = (row: Row): AdminAuctionItem => {
  const winnerName = row.winner ? `${row.winner.first_name || ''} ${row.winner.last_name || ''}`.trim() : '';
  return {
    ...row,
    winner_name: winnerName || null,
    winner_email: row.winner?.email || null,
    product_name: row.product?.name || null,
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
        .select('*, winner:profiles!current_winner_id(first_name, last_name, email), product:products(name)')
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
      .channel(`admin-auction-items-${sessionId}`)
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

  return { items, loading, error, refresh: fetchItems, addItem, removeItem, updateStartPrice, linkProduct, generateOrder };
};
