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

/** Membre de communauté sans abonnement en cours : accès gratuit (groupe à
 * 0 €, accès offert en cours, non classé) ou achats bloqués (groupe payant
 * sans abonnement, 0221/0228). */
export interface CommunityNonPayer extends CommunityPayer {
  member_group: number | null;
  free_access_until: string | null;
  group_price: number | null;
  free: boolean;
}

export const useCommunityNonPayers = (enabled = true) => {
  const [members, setMembers] = useState<CommunityNonPayer[]>([]);
  useEffect(() => {
    if (!enabled) return;
    (async () => {
      const today = new Date().toISOString().slice(0, 10);
      const [{ data: prices, error: pricesError }, { data, error }] = await Promise.all([
        supabase.from('community_group_prices').select('reseller_id, member_group, monthly_price, effective_from').lte('effective_from', today),
        supabase
          .from('reseller_contacts')
          .select(
            'id, reseller_id, member_group, free_access_until, community_sub_status, community_sub_price, community_sub_plan, community_sub_current_period_end, community_sub_started_at, created_at, profile:profiles(first_name, last_name, email, phone), reseller:resellers(company_name)'
          )
          .eq('is_primary', false)
          .is('access_revoked_at', null)
          .not('member_group', 'is', null),
      ]);
      if (pricesError || error) return;
      // Prix en vigueur par communauté + groupe (le plus récent déjà appliqué).
      const current = new Map<string, { price: number; from: string }>();
      for (const p of (prices || []) as { reseller_id: string; member_group: number; monthly_price: number; effective_from: string }[]) {
        const key = `${p.reseller_id}:${p.member_group}`;
        const prev = current.get(key);
        if (!prev || p.effective_from > prev.from) current.set(key, { price: Number(p.monthly_price) || 0, from: p.effective_from });
      }
      const communities = new Set(((prices || []) as { reseller_id: string }[]).map((p) => p.reseller_id));
      const now = Date.now();
      const rows = ((data || []) as unknown as (CommunityPayer & { member_group: number | null; free_access_until: string | null; created_at: string })[])
        .filter((c) => communities.has(c.reseller_id) && !['active', 'trialing', 'past_due'].includes(c.community_sub_status || ''))
        .map((c) => {
          const price = current.get(`${c.reseller_id}:${c.member_group}`)?.price ?? null;
          const freeUntil = c.free_access_until ? new Date(c.free_access_until).getTime() > now : false;
          return { ...c, group_price: price, free: freeUntil || !price };
        })
        .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
      setMembers(rows);
    })();
  }, [enabled]);
  return members;
};
