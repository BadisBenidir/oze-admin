import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

/** Membre d'une communauté partenaire abonné à son prix de groupe (0214). */
export interface CommunityPayer {
  id: string;
  reseller_id: string;
  community_sub_status: string;
  community_sub_price: number | null;
  community_sub_plan: string | null;
  community_sub_current_period_end: string | null;
  community_sub_started_at: string | null;
  profile: { first_name: string | null; last_name: string | null; email: string | null; phone: string | null } | null;
  reseller: { company_name: string } | null;
}

export const communityPayerName = (c: CommunityPayer) =>
  [c.profile?.first_name, c.profile?.last_name].filter(Boolean).join(' ') || c.profile?.email || 'Membre';

/** Membres des communautés (accompagnement d'Aurel…) dont l'abonnement est en cours. */
export const useCommunityPayers = (enabled = true) => {
  const [payers, setPayers] = useState<CommunityPayer[]>([]);
  useEffect(() => {
    if (!enabled) return;
    supabase
      .from('reseller_contacts')
      .select(
        'id, reseller_id, community_sub_status, community_sub_price, community_sub_plan, community_sub_current_period_end, community_sub_started_at, profile:profiles(first_name, last_name, email, phone), reseller:resellers(company_name)'
      )
      .in('community_sub_status', ['active', 'trialing', 'past_due'])
      .then(({ data, error }) => {
        if (error) return;
        const rows = (data || []) as unknown as CommunityPayer[];
        // Plus récent abonné en premier.
        rows.sort((a, b) => (b.community_sub_started_at || '').localeCompare(a.community_sub_started_at || ''));
        setPayers(rows);
      });
  }, [enabled]);
  return payers;
};
