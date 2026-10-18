import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

/**
 * Prix d'abonnement mensuels des groupes d'accès d'une communauté partenaire
 * (community_group_prices, 0212) : historique des changements programmés.
 */
export interface GroupPriceRow {
  id: string;
  member_group: number;
  monthly_price: number;
  effective_from: string; // YYYY-MM-DD
  /** Message de l'admin affiché aux membres du groupe avec l'annonce (0213). */
  message: string | null;
}

export interface GroupPriceInfo {
  current: GroupPriceRow | null;
  upcoming: GroupPriceRow | null;
}

/** Prix d'abonnement suggérés par groupe (1 = 0 €, 2 = 300 €, 3 = 700 € payés à l'entrée, 4 = nouveau). */
export const DEFAULT_GROUP_PRICES: Record<number, number> = { 1: 49.9, 2: 44.9, 3: 0, 4: 49.9 };

const todayKey = () => new Date().toLocaleDateString('en-CA');

/** Prix en vigueur et prochain changement de chaque groupe. */
export const groupPriceInfo = (rows: GroupPriceRow[]): Record<number, GroupPriceInfo> => {
  const today = todayKey();
  const out: Record<number, GroupPriceInfo> = {};
  for (const g of [1, 2, 3, 4]) {
    const list = rows.filter((r) => r.member_group === g).sort((a, b) => a.effective_from.localeCompare(b.effective_from));
    const past = list.filter((r) => r.effective_from <= today);
    out[g] = { current: past[past.length - 1] || null, upcoming: list.find((r) => r.effective_from > today) || null };
  }
  return out;
};

export const formatMonthlyPrice = (n: number) =>
  `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €/mois`;

export const formatPriceDate = (key: string) =>
  new Date(`${key}T00:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

export const useCommunityGroupPrices = (resellerId: string | null | undefined) => {
  const [rows, setRows] = useState<GroupPriceRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!resellerId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from('community_group_prices')
      .select('id, member_group, monthly_price, effective_from, message')
      .eq('reseller_id', resellerId)
      .order('effective_from', { ascending: true });
    setRows(error ? [] : ((data || []) as GroupPriceRow[]).map((r) => ({ ...r, monthly_price: Number(r.monthly_price) })));
    setLoading(false);
  }, [resellerId]);

  useEffect(() => {
    load();
  }, [load]);

  return { rows, info: groupPriceInfo(rows), loading, refresh: load };
};
