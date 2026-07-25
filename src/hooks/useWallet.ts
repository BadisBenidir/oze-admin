import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { invokeEdgeFunction } from '../utils/invokeEdgeFunction';

export interface WalletTransaction {
  id: string;
  amount: number;
  type: 'rechargement' | 'achat' | 'remboursement' | 'ajustement_admin';
  status: 'pending' | 'success' | 'failed';
  order_id: string | null;
  note: string | null;
  created_at: string;
}

interface TopUpResult {
  success: boolean;
  error?: string;
}

/**
 * Solde et historique du portefeuille B2B, scopés par PROFIL INDIVIDUEL
 * (voir useB2BCart : chaque contact d'une même entreprise a son propre
 * panier et son propre solde, jamais partagé).
 */
export const useWallet = (profileId: string | undefined) => {
  const [balance, setBalance] = useState<number>(0);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!profileId) {
      setBalance(0);
      setTransactions([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const [{ data: profileData }, { data: txData }] = await Promise.all([
      supabase.from('profiles').select('wallet_balance').eq('id', profileId).single(),
      supabase
        .from('wallet_transactions')
        .select('id, amount, type, status, order_id, note, created_at')
        .eq('profile_id', profileId)
        .order('created_at', { ascending: false }),
    ]);

    setBalance(Number(profileData?.wallet_balance ?? 0));
    setTransactions((txData || []) as WalletTransaction[]);
    setLoading(false);
  }, [profileId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const topUp = async (amount: number): Promise<TopUpResult> => {
    const { data, error } = await invokeEdgeFunction<{ url: string }>('wallet-topup', { amount });
    if (error) {
      return { success: false, error };
    }
    if (!data?.url) {
      return { success: false, error: 'Réponse de paiement invalide' };
    }
    window.location.href = data.url;
    return { success: true };
  };

  return { balance, transactions, loading, refresh, topUp };
};
