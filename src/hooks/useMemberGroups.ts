import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { buildMemberGroups, MEMBER_GROUPS, type CustomGroupRow, type MemberGroupDef } from '../config/memberGroups';

/**
 * Groupes d'accès d'une communauté : groupes 1 à 5 et groupes personnalisés
 * créés par l'admin pour cette communauté (community_custom_groups, 0236).
 */
export const useMemberGroups = (resellerId: string | null | undefined) => {
  const [custom, setCustom] = useState<CustomGroupRow[]>([]);

  const load = useCallback(async () => {
    if (!resellerId) {
      setCustom([]);
      return;
    }
    const { data } = await supabase
      .from('community_custom_groups')
      .select('id, member_group, label, hint, color')
      .eq('reseller_id', resellerId);
    setCustom((data || []) as CustomGroupRow[]);
  }, [resellerId]);

  useEffect(() => {
    load();
  }, [load]);

  const groups: MemberGroupDef[] = useMemo(() => (resellerId ? buildMemberGroups(custom) : MEMBER_GROUPS), [custom, resellerId]);
  const groupOf = useCallback((id: number | null | undefined) => groups.find((g) => g.id === id) || null, [groups]);

  return { groups, custom, groupOf, refresh: load };
};
