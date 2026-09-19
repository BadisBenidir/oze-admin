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

const LOYALTY_TIER_AMOUNT = 1000;

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
  // Portefeuilles offerts pas encore expédiés (pending + assigned), voir
  // b2b_gift_rewards (0101/0111/0132) — remplace l'ancien pendingGifts basé
  // sur loyalty_gifts (0040), table dans laquelle plus rien n'est écrit
  // depuis 0101 : un revendeur n'avait donc plus aucun moyen de voir ses
  // cadeaux débloqués. Pas de détail produit ici (b2b_gift_rewards ne lie à
  // aucun article précis, contrairement à loyalty_gifts) : juste une
  // quantité, affichée par WalletPage.tsx sous forme de bandeau générique.
  const [pendingGiftCount, setPendingGiftCount] = useState<number>(0);

  const refresh = useCallback(async () => {
    if (!profileId) {
      setBalance(0);
      setTransactions([]);
      setCumulativePaid(0);
      setGiftsUnlocked(0);
      setPendingGiftCount(0);
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
      supabase.from('b2b_gift_rewards').select('quantity, status').eq('profile_id', profileId).neq('status', 'shipped'),
    ]);

    setBalance(Number(profileData?.wallet_balance ?? 0));
    setTransactions((txData || []) as WalletTransaction[]);
    setCumulativePaid((paidData || []).reduce((sum, row) => sum + Number(row.paid_amount ?? 0), 0));
    setGiftsUnlocked(Number(profileData?.loyalty_gifts_unlocked ?? 0));
    setPendingGiftCount((giftsData || []).reduce((sum, row) => sum + Number(row.quantity ?? 0), 0));
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

  // Sur certains comptes, loyalty_gifts_unlocked (déjà accordés) dépasse ce
  // que cumulativePaid justifierait réellement (recalcul historique — voir
  // 0131 : le cadeau a longtemps pu être accordé sur une base différente du
  // cumul strict de paid_amount). Dans ce cas il manque PLUS qu'un palier
  // plein pour le prochain cadeau, pas juste 1000 € comme l'ancien calcul
  // le supposait à tort (il plafonnait à 0 et affichait toujours "plus que
  // 1000 €", même quand le vrai manque était largement supérieur) — la
  // jauge semblait alors ne jamais avancer malgré de vraies recharges.
  const totalPaidNeededForNextGift = (giftsUnlocked + 1) * LOYALTY_TIER_AMOUNT;
  const remainingToNextTier = Math.max(totalPaidNeededForNextGift - cumulativePaid, 0);
  const progressInTier = Math.max(LOYALTY_TIER_AMOUNT - remainingToNextTier, 0);

  return {
    balance,
    transactions,
    loading,
    refresh,
    topUp,
    pendingGiftCount,
    loyaltyProgress: {
      progressInTier,
      remainingToNextTier,
      tierAmount: LOYALTY_TIER_AMOUNT,
      giftsUnlocked,
    },
  };
};
