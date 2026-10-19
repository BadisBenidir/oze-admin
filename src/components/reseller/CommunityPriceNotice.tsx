import React, { useEffect, useState } from 'react';
import { CalendarClock, CreditCard, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { invokeEdgeFunction } from '../../utils/invokeEdgeFunction';
import { groupPriceInfo, formatMonthlyPrice, formatPriceDate, personalizeMessage, GroupPriceRow } from '../../hooks/useCommunityGroupPrices';

/** Abonnement Stripe du membre encore en cours : plus d'annonce. */
const PAYING_STATUSES = new Set(['active', 'trialing', 'past_due']);

/**
 * Annonce au membre d'une communauté partenaire le prochain prix mensuel de
 * son groupe d'accès (community_group_prices, 0212), avec le message de
 * l'admin ({prénom} personnalisé). Réaffichée à chaque connexion tant que le
 * membre n'a ni coché « Ne plus afficher » (community_price_notice_dismissals,
 * 0214) ni souscrit son abonnement — le bouton principal ouvre directement le
 * paiement Stripe (community-subscription). Rien pour le contact principal,
 * un membre non classé ou un prix inchangé.
 */
export const CommunityPriceNotice: React.FC<{ profileId: string | undefined; firstName?: string | null }> = ({ profileId, firstName }) => {
  const [notice, setNotice] = useState<{ row: GroupPriceRow; previous: number | null } | null>(null);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  useEffect(() => {
    if (!profileId) return;
    // Retour du paiement Stripe : l'abonnement est en cours d'enregistrement.
    if (new URLSearchParams(window.location.search).get('abonnement_membre') === 'ok') return;
    let cancelled = false;
    (async () => {
      const { data: me } = await supabase
        .from('reseller_contacts')
        .select('reseller_id, member_group, is_primary, community_sub_status')
        .eq('profile_id', profileId)
        .maybeSingle();
      if (!me || me.is_primary || !me.member_group) return;
      if (me.community_sub_status && PAYING_STATUSES.has(me.community_sub_status)) return;

      const { data, error } = await supabase
        .from('community_group_prices')
        .select('id, member_group, monthly_price, effective_from, message')
        .eq('reseller_id', me.reseller_id)
        .eq('member_group', me.member_group);
      if (cancelled || error) return;

      const rows = ((data || []) as GroupPriceRow[]).map((r) => ({ ...r, monthly_price: Number(r.monthly_price) }));
      const { current, upcoming } = groupPriceInfo(rows)[me.member_group];
      if (!upcoming || upcoming.monthly_price === (current?.monthly_price ?? 0)) return;

      const { data: dismissed } = await supabase
        .from('community_price_notice_dismissals')
        .select('price_id')
        .eq('profile_id', profileId)
        .eq('price_id', upcoming.id)
        .maybeSingle();
      if (cancelled || dismissed) return;
      setNotice({ row: upcoming, previous: current?.monthly_price ?? null });
    })();
    return () => {
      cancelled = true;
    };
  }, [profileId]);

  if (!notice) return null;

  const close = async () => {
    const priceId = notice.row.id;
    setNotice(null);
    if (dontShowAgain && profileId) {
      await supabase.from('community_price_notice_dismissals').insert({ profile_id: profileId, price_id: priceId });
    }
  };

  const subscribe = async () => {
    setPaying(true);
    setPayError(null);
    const { data, error } = await invokeEdgeFunction<{ url: string }>('community-subscription', { action: 'checkout' });
    if (error || !data?.url) {
      setPaying(false);
      setPayError(error || 'Paiement indisponible pour le moment');
      return;
    }
    window.location.href = data.url;
  };

  const canPay = notice.row.monthly_price > 0;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50" />
      <div className="relative flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <button
          type="button"
          onClick={close}
          className="absolute right-4 top-4 z-10 rounded-full p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-900"
          aria-label="Fermer"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="overflow-y-auto px-6 pb-2 pt-8 sm:px-10">
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-50">
              <CalendarClock className="h-6 w-6 text-amber-600" />
            </div>
            <h3 className="text-xl font-semibold text-gray-900">Évolution de votre abonnement</h3>
            <p className="mt-2 text-sm text-gray-500">
              À partir du <strong className="text-gray-900">{formatPriceDate(notice.row.effective_from)}</strong>, votre abonnement OZË PARIS passe à
            </p>
            <p className="mt-2 text-4xl font-bold tabular-nums text-gray-900">{formatMonthlyPrice(notice.row.monthly_price)}</p>
            {notice.previous !== null && (
              <p className="mt-1 text-xs text-gray-400">au lieu de {formatMonthlyPrice(notice.previous)} actuellement</p>
            )}
          </div>

          {notice.row.message && (
            <div className="mt-6 rounded-xl border border-gray-100 bg-gray-50 px-5 py-4">
              <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-gray-800">
                {personalizeMessage(notice.row.message, firstName)}
              </p>
              <p className="mt-3 text-sm font-medium text-gray-500">— L'équipe OZË PARIS</p>
            </div>
          )}
        </div>

        <div className="space-y-3 border-t border-gray-100 px-6 py-5 sm:px-10">
          {canPay && (
            <button
              type="button"
              onClick={subscribe}
              disabled={paying}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gray-900 py-3 text-sm font-semibold text-white transition-colors hover:bg-gray-800 disabled:opacity-60"
            >
              <CreditCard className="h-4 w-4" />
              {paying ? 'Ouverture du paiement…' : `Activer mon abonnement dès maintenant — ${formatMonthlyPrice(notice.row.monthly_price)}`}
            </button>
          )}
          {payError && <p className="text-center text-sm text-red-600">{payError}</p>}
          <label className="flex cursor-pointer items-center justify-center gap-2 text-sm text-gray-500">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
              className="h-4 w-4 accent-gray-900"
            />
            Ne plus afficher
          </label>
        </div>
      </div>
    </div>
  );
};

export default CommunityPriceNotice;
