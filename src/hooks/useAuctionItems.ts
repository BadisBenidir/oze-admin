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
  current_winner_id: string | null;
  ends_at: string;
  status: 'active' | 'sold' | 'unsold';
  /** Repris de la fiche produit liée (product_id, voir 0105), quand elle
   * existe — absents pour un lot "à la volée" sans fiche liée. Jamais de
   * prix ici : voir reseller_auction_items (0107), qui exclut aussi
   * reserve_price de auction_items (invisible pour un revendeur). */
  description?: string | null;
  material?: string | null;
  colors?: string[] | null;
  serial_number?: string | null;
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
      // Une session 'live' prime toujours sur une 'upcoming', même si
      // celle-ci a une date de début plus proche/passée (ex: plusieurs
      // sessions de test en parallèle) — sinon un simple tri par starts_at
      // pouvait renvoyer une session encore "à venir" et vide au lieu de
      // celle réellement lancée en direct par l'admin.
      let { data: sessionData, error: sessionError } = await supabase
        .from('auction_sessions')
        .select('*')
        .eq('status', 'live')
        .order('starts_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (sessionError) throw new Error(sessionError.message);

      if (!sessionData) {
        const upcoming = await supabase
          .from('auction_sessions')
          .select('*')
          .eq('status', 'upcoming')
          .order('starts_at', { ascending: true })
          .limit(1)
          .maybeSingle();
        if (upcoming.error) throw new Error(upcoming.error.message);
        sessionData = upcoming.data;
      }
      setSession(sessionData);

      if (!sessionData) {
        setItems([]);
        setMyBidItemIds(new Set());
        return;
      }

      // reseller_auction_items (0107), pas auction_items directement : cette
      // vue résout la description/matière/etc. de la fiche produit liée
      // même quand elle est encore 'draft' (RLS produits sinon bloquante,
      // voir commentaire de la migration), et exclut reserve_price.
      const { data: itemsData, error: itemsError } = await supabase
        .from('reseller_auction_items')
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
