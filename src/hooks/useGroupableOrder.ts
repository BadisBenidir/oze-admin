import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export interface GroupableOrder {
  id: string;
  order_number: string;
  created_at: string;
}

/** Fenêtre pendant laquelle une commande payée mais non expédiée reste "groupable". */
const GROUPABLE_WINDOW_DAYS = 21;

/**
 * Cherche la commande B2B la plus récente de ce profil qui est payée, pas
 * encore expédiée, et assez récente pour raisonnablement partager un envoi
 * Sendcloud avec une nouvelle commande — utilisé par CartPage pour proposer
 * "Grouper avec ma commande en cours".
 */
export const useGroupableOrder = (profileId: string | undefined) => {
  const [order, setOrder] = useState<GroupableOrder | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const fetchGroupableOrder = async () => {
      if (!profileId) {
        setOrder(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      const cutoff = new Date(Date.now() - GROUPABLE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

      const { data, error } = await supabase
        .from('orders')
        .select('id, order_number, created_at')
        .eq('order_channel', 'b2b')
        .eq('placed_by_profile_id', profileId)
        .eq('payment_status', 'paid')
        .not('status', 'in', '(shipped,delivered,cancelled)')
        .gte('created_at', cutoff)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (cancelled) return;
      if (error) {
        console.error('Erreur lors de la recherche de commande groupable:', error.message);
        setOrder(null);
      } else {
        setOrder(data as GroupableOrder | null);
      }
      setLoading(false);
    };

    fetchGroupableOrder();
    return () => {
      cancelled = true;
    };
  }, [profileId]);

  return { groupableOrder: order, loading };
};
