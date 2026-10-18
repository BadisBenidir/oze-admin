import React, { useEffect, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { groupPriceInfo, formatMonthlyPrice, formatPriceDate, GroupPriceRow } from '../../hooks/useCommunityGroupPrices';

const DISMISS_KEY = (priceId: string) => `oze_price_notice_${priceId}`;

/**
 * Annonce au membre d'une communauté partenaire le prochain prix mensuel de
 * son groupe d'accès (community_group_prices, 0212), programmé par l'admin.
 * Réaffichée à chaque connexion jusqu'à la date d'application ; « Fermer »
 * la masque pour la session en cours. Rien pour le contact principal, un
 * membre non classé ou un prix inchangé. Lecture tolérante avant 0212.
 */
export const CommunityPriceNotice: React.FC<{ profileId: string | undefined }> = ({ profileId }) => {
  const [notice, setNotice] = useState<{ row: GroupPriceRow; previous: number | null } | null>(null);

  useEffect(() => {
    if (!profileId) return;
    let cancelled = false;
    (async () => {
      const { data: me } = await supabase
        .from('reseller_contacts')
        .select('reseller_id, member_group, is_primary')
        .eq('profile_id', profileId)
        .maybeSingle();
      if (!me || me.is_primary || !me.member_group) return;

      const { data, error } = await supabase
        .from('community_group_prices')
        .select('id, member_group, monthly_price, effective_from, message')
        .eq('reseller_id', me.reseller_id)
        .eq('member_group', me.member_group);
      if (cancelled || error) return;

      const rows = ((data || []) as GroupPriceRow[]).map((r) => ({ ...r, monthly_price: Number(r.monthly_price) }));
      const { current, upcoming } = groupPriceInfo(rows)[me.member_group];
      if (!upcoming || upcoming.monthly_price === (current?.monthly_price ?? 0)) return;
      try {
        if (sessionStorage.getItem(DISMISS_KEY(upcoming.id))) return;
      } catch {
        /* stockage indisponible : on affiche */
      }
      setNotice({ row: upcoming, previous: current?.monthly_price ?? null });
    })();
    return () => {
      cancelled = true;
    };
  }, [profileId]);

  if (!notice) return null;

  const close = () => {
    try {
      sessionStorage.setItem(DISMISS_KEY(notice.row.id), '1');
    } catch {
      /* ignore */
    }
    setNotice(null);
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40" onClick={close} />
      <div className="relative w-full max-w-md rounded-xl bg-white shadow-xl">
        <div className="p-6 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-50">
            <CalendarClock className="h-6 w-6 text-amber-600" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900">Évolution de votre abonnement</h3>
          <p className="mt-3 text-sm text-gray-600">
            À partir de votre prochaine échéance, le <strong>{formatPriceDate(notice.row.effective_from)}</strong>, votre abonnement OZË PARIS passera à
          </p>
          <p className="mt-2 text-3xl font-bold text-gray-900 tabular-nums">{formatMonthlyPrice(notice.row.monthly_price)}</p>
          {notice.previous !== null && (
            <p className="mt-1 text-xs text-gray-400">au lieu de {formatMonthlyPrice(notice.previous)} actuellement</p>
          )}
          {notice.row.message && (
            <div className="mt-5 rounded-lg border border-gray-100 bg-gray-50 p-3 text-left">
              <p className="whitespace-pre-line text-sm text-gray-700">{notice.row.message}</p>
              <p className="mt-1 text-xs text-gray-400">L'équipe OZË PARIS</p>
            </div>
          )}
        </div>
        <div className="px-6 pb-6">
          <button
            type="button"
            onClick={close}
            className="w-full rounded-lg bg-gray-900 py-2.5 text-sm font-medium text-white hover:bg-gray-800"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
};

export default CommunityPriceNotice;
