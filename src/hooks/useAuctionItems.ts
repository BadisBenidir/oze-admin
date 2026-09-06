import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

/** Boutons d'enchère rapide proposés côté revendeur (carte + fiche détail).
 * Un montant reste désactivé si inférieur à item.min_increment — le
 * serveur (handle_new_bid, 0104) rejetterait de toute façon l'enchère. */
export const QUICK_BID_INCREMENTS = [5, 10, 20];

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
  const [myMaxAmounts, setMyMaxAmounts] = useState<Map<string, number>>(new Map());
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
          .select('item_id, max_amount')
          .eq('user_id', profileId)
          .in('item_id', (itemsData || []).map((i) => i.id));
        if (bidsError) throw new Error(bidsError.message);
        // Un même lot peut avoir plusieurs lignes (plafond relevé plusieurs
        // fois) — on ne garde que le plafond le plus haut posé par l'utilisateur.
        const maxByItem = new Map<string, number>();
        for (const b of bidsData || []) {
          const prev = maxByItem.get(b.item_id) || 0;
          if ((b.max_amount || 0) > prev) maxByItem.set(b.item_id, b.max_amount || 0);
        }
        setMyMaxAmounts(maxByItem);
        setMyBidItemIds(new Set(maxByItem.keys()));
      } else {
        setMyMaxAmounts(new Map());
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

  /**
   * Enchère automatique (proxy bidding) : maxAmount est un plafond secret,
   * pas une mise ponctuelle — place_auto_bid (0108) place seule la mise
   * minimale nécessaire pour mener et resurenchérit plus tard jusqu'à ce
   * plafond. `warning` reste renseigné même en succès quand l'utilisateur a
   * été immédiatement surenchéri par un plafond concurrent déjà supérieur.
   */
  const placeAutoBid = async (itemId: string, maxAmount: number): Promise<{ success: boolean; error?: string; warning?: string }> => {
    if (!profileId) return { success: false, error: 'Profil inconnu' };
    const { data, error: rpcError } = await supabase.rpc('place_auto_bid', { p_item_id: itemId, p_max_amount: maxAmount });
    if (rpcError) return { success: false, error: rpcError.message };
    const row = (Array.isArray(data) ? data[0] : data) as { success: boolean; message: string | null } | null;
    if (!row?.success) return { success: false, error: row?.message || "Erreur lors de l'enchère" };
    await fetchAll();
    return { success: true, warning: row.message || undefined };
  };

  return { session, items, myBidItemIds, myMaxAmounts, loading, error, placeAutoBid, refresh: fetchAll };
};
