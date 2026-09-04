import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export interface GiftReward {
  id: string;
  reseller_id: string;
  profile_id: string;
  transaction_id: string;
  /** Montant réellement rechargé ayant déclenché ce(s) portefeuille(s) offert(s) — voir 0101. */
  recharge_amount: number;
  /** Nombre de portefeuilles offerts dus pour cette recharge (Math.floor(montant / 500)). */
  quantity: number;
  status: 'pending' | 'assigned' | 'shipped';
  assigned_order_id: string | null;
  assigned_order_number: string | null;
  shipped_at: string | null;
  shipped_note: string | null;
  /** Date de la recharge elle-même (wallet_transactions.created_at), pas la date de création de cette ligne de suivi. */
  recharge_date: string;
  company_name: string;
  requester_name: string;
  requester_email: string | null;
}

type Row = {
  id: string;
  reseller_id: string;
  profile_id: string;
  transaction_id: string;
  recharge_amount: number;
  quantity: number;
  status: 'pending' | 'assigned' | 'shipped';
  assigned_order_id: string | null;
  shipped_at: string | null;
  shipped_note: string | null;
  created_at: string;
  wallet_transactions: { created_at: string } | null;
  resellers: { company_name: string } | null;
  profiles: { first_name: string | null; last_name: string | null; email: string | null } | null;
  orders: { order_number: string } | null;
};

const SELECT_COLUMNS =
  '*, wallet_transactions(created_at), resellers(company_name), profiles(first_name, last_name, email), orders(order_number)';

const mapRow = (row: Row): GiftReward => {
  const requesterName = `${row.profiles?.first_name || ''} ${row.profiles?.last_name || ''}`.trim();
  return {
    id: row.id,
    reseller_id: row.reseller_id,
    profile_id: row.profile_id,
    transaction_id: row.transaction_id,
    recharge_amount: Number(row.recharge_amount) || 0,
    quantity: row.quantity,
    status: row.status,
    assigned_order_id: row.assigned_order_id,
    assigned_order_number: row.orders?.order_number || null,
    shipped_at: row.shipped_at,
    shipped_note: row.shipped_note,
    recharge_date: row.wallet_transactions?.created_at || row.created_at,
    company_name: row.resellers?.company_name || '—',
    requester_name: requesterName || row.profiles?.email || '—',
    requester_email: row.profiles?.email || null,
  };
};

/**
 * Portefeuilles offerts dus (>= 500 € rechargés, voir 0101_b2b_gift_rewards.sql)
 * — vue admin globale, pour la page "Portefeuilles offerts" et le badge de
 * la barre latérale.
 */
export const useGiftRewards = (isAdmin: boolean = false) => {
  const [rewards, setRewards] = useState<GiftReward[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRewards = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const { data, error: fetchError } = await supabase
        .from('b2b_gift_rewards')
        .select(SELECT_COLUMNS)
        .order('created_at', { ascending: false });
      if (fetchError) throw new Error(fetchError.message);
      setRewards(((data || []) as unknown as Row[]).map(mapRow));
    } catch (err) {
      console.error('Erreur lors du chargement des portefeuilles offerts:', err);
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
    fetchRewards();
  }, [isAdmin, fetchRewards]);

  const assignToOrder = async (giftId: string, orderId: string): Promise<{ success: boolean; error?: string }> => {
    const { error: updateError } = await supabase
      .from('b2b_gift_rewards')
      .update({ status: 'assigned', assigned_order_id: orderId })
      .eq('id', giftId)
      .eq('status', 'pending');
    if (updateError) return { success: false, error: updateError.message };
    await fetchRewards();
    return { success: true };
  };

  const markShipped = async (
    giftId: string,
    options: { note?: string; orderId?: string } = {}
  ): Promise<{ success: boolean; error?: string }> => {
    const payload: Record<string, unknown> = {
      status: 'shipped',
      shipped_at: new Date().toISOString(),
      shipped_note: options.note?.trim() || null,
    };
    if (options.orderId) payload.assigned_order_id = options.orderId;

    const { error: updateError } = await supabase
      .from('b2b_gift_rewards')
      .update(payload)
      .eq('id', giftId)
      .neq('status', 'shipped');
    if (updateError) return { success: false, error: updateError.message };
    await fetchRewards();
    return { success: true };
  };

  return { rewards, loading, error, refresh: fetchRewards, assignToOrder, markShipped };
};

/** Compteur léger pour le badge de la barre latérale — total de
 * portefeuilles pas encore expédiés (pending + assigned), tous revendeurs. */
export const usePendingGiftRewardsCount = (isAdmin: boolean = false) => {
  const [count, setCount] = useState(0);

  const fetchCount = useCallback(async () => {
    const { data, error } = await supabase.from('b2b_gift_rewards').select('quantity').neq('status', 'shipped');
    if (error) {
      console.error('Erreur lors du chargement du compteur de portefeuilles offerts:', error);
      return;
    }
    setCount((data || []).reduce((sum, row: { quantity: number }) => sum + (row.quantity || 0), 0));
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    fetchCount();
  }, [isAdmin, fetchCount]);

  return count;
};
