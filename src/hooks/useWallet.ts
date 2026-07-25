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

export interface LoyaltyGift {
  id: string;
  product_id: string;
  tier_reached: number;
  status: 'pending_discovery' | 'discovered' | 'included_in_order';
  assigned_at: string;
  product_name: string;
  product_images: string[];
  product_main_image_index: number;
  product_condition: string;
  product_description: string | null;
}

interface TopUpResult {
  success: boolean;
  error?: string;
}

const LOYALTY_TIER_AMOUNT = 500;

/**
 * Solde et historique du portefeuille B2B, scopés par PROFIL INDIVIDUEL
 * (voir useB2BCart : chaque contact d'une même entreprise a son propre
 * panier et son propre solde, jamais partagé). Idem pour la progression
 * fidélité : calculée sur le cumul PAYÉ de CE profil (même règle que
 * credit_wallet_topup côté serveur), jamais partagée entre contacts d'une
 * même entreprise revendeuse.
 */
export const useWallet = (profileId: string | undefined) => {
  const [balance, setBalance] = useState<number>(0);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [cumulativePaid, setCumulativePaid] = useState<number>(0);
  const [giftsUnlocked, setGiftsUnlocked] = useState<number>(0);
  const [pendingGifts, setPendingGifts] = useState<LoyaltyGift[]>([]);

  const refresh = useCallback(async () => {
    if (!profileId) {
      setBalance(0);
      setTransactions([]);
      setCumulativePaid(0);
      setGiftsUnlocked(0);
      setPendingGifts([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const [{ data: profileData }, { data: txData }, { data: paidData }, { data: giftsData }] = await Promise.all([
      supabase.from('profiles').select('wallet_balance, loyalty_gifts_unlocked').eq('id', profileId).single(),
      supabase
        .from('wallet_transactions')
        .select('id, amount, type, status, order_id, note, created_at')
        .eq('profile_id', profileId)
        .order('created_at', { ascending: false }),
      supabase
        .from('wallet_transactions')
        .select('paid_amount')
        .eq('profile_id', profileId)
        .eq('type', 'rechargement'),
      supabase.rpc('get_my_pending_loyalty_gifts'),
    ]);

    setBalance(Number(profileData?.wallet_balance ?? 0));
    setTransactions((txData || []) as WalletTransaction[]);
    setCumulativePaid((paidData || []).reduce((sum, row) => sum + Number(row.paid_amount ?? 0), 0));
    setGiftsUnlocked(Number(profileData?.loyalty_gifts_unlocked ?? 0));
    setPendingGifts((giftsData || []) as unknown as LoyaltyGift[]);
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

  const markGiftDiscovered = async (giftId: string) => {
    await supabase.rpc('mark_loyalty_gift_discovered', { p_gift_id: giftId });
    setPendingGifts((prev) => prev.map((g) => (g.id === giftId ? { ...g, status: 'discovered' } : g)));
  };

  const progressInTier = Math.min(Math.max(cumulativePaid - giftsUnlocked * LOYALTY_TIER_AMOUNT, 0), LOYALTY_TIER_AMOUNT);
  const remainingToNextTier = Math.max(LOYALTY_TIER_AMOUNT - progressInTier, 0);

  return {
    balance,
    transactions,
    loading,
    refresh,
    topUp,
    pendingGifts,
    markGiftDiscovered,
    loyaltyProgress: {
      progressInTier,
      remainingToNextTier,
      tierAmount: LOYALTY_TIER_AMOUNT,
      giftsUnlocked,
    },
  };
};
