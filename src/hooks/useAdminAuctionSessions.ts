import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export interface AuctionSession {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  status: 'upcoming' | 'live' | 'closed';
  created_at: string;
}

export interface AuctionSessionInput {
  title: string;
  starts_at: string;
  ends_at: string;
}

/** Sessions d'enchères — CRUD admin (auction_sessions, voir 0104). La RLS
 * `for all using (is_admin())` couvre déjà tout le CRUD basique, aucune RPC
 * n'est nécessaire pour créer/modifier/forcer un statut. */
export const useAdminAuctionSessions = (isAdmin: boolean = false) => {
  const [sessions, setSessions] = useState<AuctionSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSessions = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const { data, error: fetchError } = await supabase
        .from('auction_sessions')
        .select('*')
        .order('starts_at', { ascending: false });
      if (fetchError) throw new Error(fetchError.message);
      setSessions(data || []);
    } catch (err) {
      console.error('Erreur lors du chargement des sessions d\'enchères:', err);
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    fetchSessions();
  }, [isAdmin, fetchSessions]);

  const createSession = async (input: AuctionSessionInput): Promise<{ success: boolean; error?: string }> => {
    const { error: insertError } = await supabase.from('auction_sessions').insert({
      title: input.title.trim(),
      starts_at: input.starts_at,
      ends_at: input.ends_at,
    });
    if (insertError) return { success: false, error: insertError.message };
    await fetchSessions();
    return { success: true };
  };

  /** Modifie une session pas encore ouverte. Les lots (auction_items.ends_at)
   * et les pass hebdo (auction_access.valid_until) recopient ends_at de la
   * session à leur création — on les recale sur la nouvelle date de fin. */
  const updateSession = async (id: string, input: AuctionSessionInput): Promise<{ success: boolean; error?: string }> => {
    const { data: updated, error: updateError } = await supabase
      .from('auction_sessions')
      .update({ title: input.title.trim(), starts_at: input.starts_at, ends_at: input.ends_at })
      .eq('id', id)
      .eq('status', 'upcoming')
      .select('id');
    if (updateError) return { success: false, error: updateError.message };
    if (!updated || updated.length === 0) {
      await fetchSessions();
      return { success: false, error: 'Cette session a déjà démarré — elle ne peut plus être modifiée.' };
    }
    const { error: itemsError } = await supabase
      .from('auction_items')
      .update({ ends_at: input.ends_at })
      .eq('session_id', id)
      .eq('status', 'active');
    if (itemsError) return { success: false, error: itemsError.message };
    const { error: accessError } = await supabase
      .from('auction_access')
      .update({ valid_until: input.ends_at })
      .eq('session_id', id)
      .eq('access_type', 'weekly_pass');
    if (accessError) return { success: false, error: accessError.message };
    await fetchSessions();
    return { success: true };
  };

  const setSessionStatus = async (id: string, status: AuctionSession['status']): Promise<{ success: boolean; error?: string }> => {
    if (status === 'closed') {
      const { error: rpcError } = await supabase.rpc('admin_close_auction_session', { p_session_id: id });
      if (rpcError) return { success: false, error: rpcError.message };
    } else {
      const { error: updateError } = await supabase.from('auction_sessions').update({ status }).eq('id', id);
      if (updateError) return { success: false, error: updateError.message };
    }
    await fetchSessions();
    return { success: true };
  };

  const deleteSession = async (id: string): Promise<{ success: boolean; error?: string }> => {
    // on delete cascade sur auction_items.session_id / auction_bids.item_id
    // (0104) : supprime aussi ses lots et leurs enchères.
    const { error: deleteError } = await supabase.from('auction_sessions').delete().eq('id', id);
    if (deleteError) return { success: false, error: deleteError.message };
    await fetchSessions();
    return { success: true };
  };

  return { sessions, loading, error, refresh: fetchSessions, createSession, updateSession, setSessionStatus, deleteSession };
};
