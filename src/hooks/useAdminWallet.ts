import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export interface AdminWalletTransaction {
  id: string;
  amount: number;
  type: 'rechargement' | 'achat' | 'remboursement' | 'ajustement_admin';
  status: 'pending' | 'success' | 'failed';
  order_id: string | null;
  note: string | null;
  created_at: string;
}

interface UseAdminWalletResult {
  balance: number;
  transactions: AdminWalletTransaction[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  adjustBalance: (amount: number, note: string) => Promise<{ success: boolean; error?: string }>;
}

/** Solde et historique du portefeuille d'UN contact précis (vue admin — voir ResellerDetail.tsx). */
export const useAdminWallet = (profileId: string | undefined): UseAdminWalletResult => {
  const [balance, setBalance] = useState(0);
  const [transactions, setTransactions] = useState<AdminWalletTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!profileId) {
      setBalance(0);
      setTransactions([]);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const [{ data: profileData, error: profileError }, { data: txData, error: txError }] = await Promise.all([
        supabase.from('profiles').select('wallet_balance').eq('id', profileId).single(),
        supabase
          .from('wallet_transactions')
          .select('id, amount, type, status, order_id, note, created_at')
          .eq('profile_id', profileId)
          .order('created_at', { ascending: false }),
      ]);

      if (profileError) throw new Error(profileError.message);
      if (txError) throw new Error(txError.message);

      setBalance(Number(profileData?.wallet_balance ?? 0));
      setTransactions((txData || []) as AdminWalletTransaction[]);
    } catch (err) {
      console.error('Erreur lors du chargement du portefeuille:', err);
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }, [profileId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const adjustBalance = async (amount: number, note: string): Promise<{ success: boolean; error?: string }> => {
    if (!profileId) return { success: false, error: 'Aucun contact sélectionné' };

    const { error: rpcError } = await supabase.rpc('admin_adjust_wallet_balance', {
      p_profile_id: profileId,
      p_amount: amount,
      p_note: note,
    });

    if (rpcError) return { success: false, error: rpcError.message };
    await refresh();
    return { success: true };
  };

  return { balance, transactions, loading, error, refresh, adjustBalance };
};
