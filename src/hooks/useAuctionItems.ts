import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export interface AuctionSession {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  status: 'upcoming' | 'live' | 'closed';
}

export interface AuctionItem {
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
  ends_at: string;
  status: 'active' | 'sold' | 'unsold';
}

/**
 * Session d'enchères en cours ou à venir + ses lots, avec mise à jour
 * temps réel (Supabase Realtime, même pattern que Catalog.tsx /
 * useB2BProduct.ts pour product_reservation_signals : le callback
 * déclenche un simple refetch plutôt que de lire le payload). `myBidItemIds`
 * permet d'afficher "Surenchéri" pour un lot où le profil a déjà misé mais
 * n'est plus l'enchérisseur actuel.
 */
export const useAuctionItems = (enabled: boolean, profileId?: string | null) => {
  const [session, setSession] = useState<AuctionSession | null>(null);
  const [items, setItems] = useState<AuctionItem[]>([]);
  const [myBidItemIds, setMyBidItemIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      setError(null);
      const { data: sessionData, error: sessionError } = await supabase
        .from('auction_sessions')
        .select('*')
        .in('status', ['live', 'upcoming'])
        .order('starts_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (sessionError) throw new Error(sessionError.message);
      setSession(sessionData);

      if (!sessionData) {
        setItems([]);
        setMyBidItemIds(new Set());
        return;
      }

      const { data: itemsData, error: itemsError } = await supabase
        .from('auction_items')
        .select('*')
        .eq('session_id', sessionData.id)
        .order('created_at', { ascending: true });
      if (itemsError) throw new Error(itemsError.message);
      setItems(itemsData || []);

      if (profileId) {
        const { data: bidsData, error: bidsError } = await supabase
          .from('auction_bids')
          .select('item_id')
          .eq('user_id', profileId)
          .in('item_id', (itemsData || []).map((i) => i.id));
        if (bidsError) throw new Error(bidsError.message);
        setMyBidItemIds(new Set((bidsData || []).map((b) => b.item_id)));
      } else {
        setMyBidItemIds(new Set());
      }
    } catch (err) {
      console.error("Erreur lors du chargement de l'enchère:", err);
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }, [profileId]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    fetchAll();
  }, [enabled, fetchAll]);

  useEffect(() => {
    if (!enabled) return;
    const channel = supabase
      .channel('auction-live-updates')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'auction_items' }, () => fetchAll())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'auction_bids' }, () => fetchAll())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, fetchAll]);

  const placeBid = async (itemId: string, amount: number): Promise<{ success: boolean; error?: string }> => {
    if (!profileId) return { success: false, error: 'Profil inconnu' };
    const { error: insertError } = await supabase.from('auction_bids').insert({ item_id: itemId, user_id: profileId, amount });
    if (insertError) return { success: false, error: insertError.message };
    await fetchAll();
    return { success: true };
  };

  return { session, items, myBidItemIds, loading, error, placeBid, refresh: fetchAll };
};
