import React, { useEffect, useState } from 'react';
import { CalendarClock, CreditCard, Lock, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { invokeEdgeFunction } from '../../utils/invokeEdgeFunction';
import { groupPriceInfo, formatMonthlyPrice, formatPriceDate, personalizeMessage, GroupPriceRow } from '../../hooks/useCommunityGroupPrices';

/** Abonnement Stripe du membre encore en cours : plus d'annonce ni de coupure. */
const PAYING_STATUSES = new Set(['active', 'trialing', 'past_due']);

type NoticeState =
  /** Prix à venir : fenêtre à la connexion puis bandeau, coupure annoncée si le prix est payant. */
  | { mode: 'announce'; row: GroupPriceRow; previous: number | null; subscriber: boolean; dismissed: boolean }
  /** Date passée, groupe payant, pas d'abonnement : accès suspendu jusqu'au paiement. */
  | { mode: 'blocked'; row: GroupPriceRow; price: number; newcomer: boolean };

/**
 * Abonnement des membres d'une communauté partenaire (community_group_prices,
 * 0212 ; abonnement 0214) :
 *   - AVANT la date d'un nouveau prix : fenêtre à chaque connexion (message de
 *     l'admin, {prénom} personnalisé, bouton de paiement Stripe), puis bandeau
 *     en haut de l'espace jusqu'au paiement. « Ne plus afficher » ne masque
 *     que la fenêtre. Groupe à 0 € : la fenêtre (message seul), sans paiement.
 *     Coupure annoncée : sans abonnement à la date, l'accès est suspendu.
 *   - À PARTIR de la date : un membre d'un groupe payant sans abonnement en
 *     cours garde l'accès à tout en consultation, avec un bandeau permanent et
 *     le paiement ; commander / enchérir / sourcing sont refusés côté serveur
 *     (community_access_blocked, 0221 / 0228).
 * Jamais pour le contact principal ni un membre non classé.
 */
export const CommunityPriceNotice: React.FC<{ profileId: string | undefined; firstName?: string | null }> = ({ profileId, firstName }) => {
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [activating, setActivating] = useState(false);

  useEffect(() => {
    if (!profileId) return;
    let cancelled = false;
    const justPaid = new URLSearchParams(window.location.search).get('abonnement_membre') === 'ok';

    const load = async (): Promise<boolean> => {
      const { data: me } = await supabase
        .from('reseller_contacts')
        .select('reseller_id, member_group, is_primary, community_sub_status, community_sub_stripe_subscription_id, community_sub_price, community_sub_plan, free_access_until, created_at')
        .eq('profile_id', profileId)
        .maybeSingle();
      if (!me || me.is_primary || !me.member_group) return true;
      // Accès offert en cours (groupe 5, offre 2 000 €) : ni annonce ni coupure.
      if (me.free_access_until && new Date(me.free_access_until).getTime() > Date.now()) return true;
      const subscriber = Boolean(me.community_sub_status && PAYING_STATUSES.has(me.community_sub_status));
      // Passé au Pass Drops : son prix ne suit plus celui de son groupe.
      if (subscriber && me.community_sub_plan === 'drops') return true;

      const { data, error } = await supabase
        .from('community_group_prices')
        .select('id, member_group, monthly_price, effective_from, message')
        .eq('reseller_id', me.reseller_id)
        .eq('member_group', me.member_group);
      if (cancelled || error) return true;
      const rows = ((data || []) as GroupPriceRow[]).map((r) => ({ ...r, monthly_price: Number(r.monthly_price) }));
      const { current, upcoming } = groupPriceInfo(rows)[me.member_group] ?? { current: null, upcoming: null };

      // Coupure : prix en vigueur payant et aucun abonnement en cours.
      if (!subscriber && current && current.monthly_price > 0) {
        if (justPaid) return false; // paiement en cours d'enregistrement : on attend le webhook
        // Prix réel d'un (ré)abonnement (un ancien abonné repaie au moins le prix public).
        const { data: status } = await invokeEdgeFunction<{ subscribe_price: number | null }>('community-subscription', { action: 'status' });
        if (cancelled) return true;
        // Inscrit après l'entrée en vigueur du prix (ex. lien « Nouveaux membres ») : accueil, pas « suspendu ».
        const newcomer = !me.community_sub_stripe_subscription_id && new Date(me.created_at).toLocaleDateString('en-CA') >= current.effective_from;
        setNotice({ mode: 'blocked', row: current, price: status?.subscribe_price ?? current.monthly_price, newcomer });
        return true;
      }

      if (!upcoming) return true;
      // Ancien abonné (résilié) : se réabonne depuis Mon profil, pas d'annonce.
      if (!subscriber && me.community_sub_stripe_subscription_id) return true;
      const paidPrice = subscriber ? Number(me.community_sub_price ?? 0) : null;
      const unchanged = upcoming.monthly_price === (paidPrice ?? current?.monthly_price ?? 0);
      // Prix inchangé : rien, sauf un message de l'admin (ex. groupe à 0 €).
      if (unchanged && !upcoming.message) return true;
      if (justPaid && !subscriber && upcoming.monthly_price > 0) return false;

      const { data: dismissed } = await supabase
        .from('community_price_notice_dismissals')
        .select('price_id')
        .eq('profile_id', profileId)
        .eq('price_id', upcoming.id)
        .maybeSingle();
      if (cancelled) return true;
      const informOnly = subscriber || upcoming.monthly_price <= 0;
      if (informOnly && dismissed) return true;
      setNotice({ mode: 'announce', row: upcoming, previous: paidPrice ?? current?.monthly_price ?? null, subscriber, dismissed: Boolean(dismissed) });
      setModalOpen(!dismissed);
      return true;
    };

    (async () => {
      // Retour du paiement Stripe : le webhook enregistre l'abonnement en quelques secondes.
      if (justPaid) setActivating(true);
      for (let attempt = 0; attempt < (justPaid ? 8 : 1); attempt++) {
        if (cancelled) return;
        if (attempt > 0) await new Promise((r) => setTimeout(r, 2500));
        if (await load()) break;
      }
      if (!cancelled) setActivating(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [profileId]);

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

  if (activating && !notice) {
    return (
      <div className="mx-4 mt-4 md:mx-6 md:mt-6 rounded-2xl border border-green-200 bg-green-50 px-5 py-4 text-sm text-green-800">
        Paiement reçu : votre abonnement s'active, un instant…
      </div>
    );
  }
  if (!notice) return null;

  const message = notice.row.message ? personalizeMessage(notice.row.message, firstName) : '';

  // ---- Abonnement non actif (date passée) : consultation seulement ----
  // Le membre garde l'accès à tout (catalogue, commandes, factures,
  // portefeuille, suivi) ; commander / enchérir / sourcing sont refusés côté
  // serveur (0228) jusqu'au paiement. Bandeau permanent, non fermable.
  if (notice.mode === 'blocked') {
    return (
      <div className="mx-4 mt-4 md:mx-6 md:mt-6 overflow-hidden rounded-2xl bg-gray-900 text-white shadow-lg">
        <div className={`flex flex-col gap-5 p-5 md:flex-row md:gap-8 md:p-6 ${expanded ? 'md:items-start' : 'md:items-center'}`}>
          <div className="flex items-center gap-4 md:border-r md:border-white/10 md:pr-8">
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-white/10">
              <Lock className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-gray-400">Votre abonnement</p>
              <p className="text-2xl font-bold tabular-nums">{formatMonthlyPrice(notice.price)}</p>
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold">
              {notice.newcomer
                ? `Bienvenue${firstName ? ` ${firstName}` : ''} ! Activez votre abonnement pour commander`
                : "Votre abonnement OZË PARIS n'est pas encore actif"}
            </p>
            <p className="mt-0.5 text-sm text-gray-300">
              Vous gardez l'accès à votre espace, vos commandes, vos factures et votre portefeuille. Pour commander, enchérir ou
              lancer un sourcing, activez votre abonnement.
            </p>
            {message && (
              <>
                {expanded ? (
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-200">{message}</p>
                ) : null}
                <button
                  type="button"
                  onClick={() => setExpanded((v) => !v)}
                  className="mt-1 text-xs font-medium text-white underline underline-offset-2 hover:text-gray-300"
                >
                  {expanded ? 'Réduire' : 'Lire le message'}
                </button>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={subscribe}
            disabled={paying}
            className="flex flex-shrink-0 items-center justify-center gap-2.5 rounded-xl bg-white px-8 py-4 text-base font-semibold text-gray-900 shadow-sm transition-colors hover:bg-gray-100 disabled:opacity-60 md:min-w-[280px]"
          >
            <CreditCard className="h-5 w-5" />
            {paying ? 'Ouverture du paiement…' : 'Activer mon abonnement'}
          </button>
        </div>
        {payError && <p className="border-t border-white/10 px-6 py-2 text-sm text-red-300">{payError}</p>}
      </div>
    );
  }

  // ---- Annonce d'un prix à venir ----
  const close = async () => {
    setModalOpen(false);
    if (dontShowAgain && profileId) {
      await supabase.from('community_price_notice_dismissals').upsert({ profile_id: profileId, price_id: notice.row.id }, { ignoreDuplicates: true });
    }
  };

  const free = notice.row.monthly_price <= 0;
  const canPay = !notice.subscriber && !free;
  const cutoffWarning = canPay
    ? `Sans abonnement actif le ${formatPriceDate(notice.row.effective_from)}, votre accès à l'espace OZË PARIS sera suspendu.`
    : null;
  const preview = message.replace(/\s+/g, ' ').trim();

  // Abonné ou groupe à 0 € : simple information, pas de bandeau une fois fermée.
  if (!modalOpen && !canPay) return null;

  if (!modalOpen) {
    return (
      <div className="mx-4 mt-4 md:mx-6 md:mt-6 overflow-hidden rounded-2xl bg-gray-900 text-white shadow-lg">
        <div className={`flex flex-col gap-5 p-5 md:flex-row md:gap-8 md:p-6 ${expanded ? 'md:items-start' : 'md:items-center'}`}>
          <div className="flex items-center gap-4 md:border-r md:border-white/10 md:pr-8">
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-white/10">
              <CalendarClock className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-gray-400">
                Dès le {formatPriceDate(notice.row.effective_from)}
              </p>
              <p className="text-2xl font-bold tabular-nums">{formatMonthlyPrice(notice.row.monthly_price)}</p>
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold">Votre abonnement OZË PARIS évolue</p>
            {cutoffWarning && <p className="mt-0.5 text-sm font-medium text-amber-300">{cutoffWarning}</p>}
            {preview && (
              <>
                {expanded ? (
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-200">{message}</p>
                ) : (
                  <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-gray-300">{preview}</p>
                )}
                <button
                  type="button"
                  onClick={() => setExpanded((v) => !v)}
                  className="mt-1 text-xs font-medium text-white underline underline-offset-2 hover:text-gray-300"
                >
                  {expanded ? 'Réduire' : 'Lire le message'}
                </button>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={subscribe}
            disabled={paying}
            className="flex flex-shrink-0 items-center justify-center gap-2.5 rounded-xl bg-white px-8 py-4 text-base font-semibold text-gray-900 shadow-sm transition-colors hover:bg-gray-100 disabled:opacity-60 md:min-w-[280px]"
          >
            <CreditCard className="h-5 w-5" />
            {paying ? 'Ouverture du paiement…' : 'Activer mon abonnement'}
          </button>
        </div>
        {payError && <p className="border-t border-white/10 px-6 py-2 text-sm text-red-300">{payError}</p>}
      </div>
    );
  }

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
            <h3 className="text-xl font-semibold text-gray-900">{free ? 'Votre accès OZË PARIS' : 'Évolution de votre abonnement'}</h3>
            {free ? (
              <p className="mt-2 text-sm text-gray-500">
                À partir du <strong className="text-gray-900">{formatPriceDate(notice.row.effective_from)}</strong>, votre accès reste <strong className="text-gray-900">offert</strong>.
              </p>
            ) : (
              <>
                <p className="mt-2 text-sm text-gray-500">
                  {notice.subscriber
                    ? <>À partir de votre première échéance après le <strong className="text-gray-900">{formatPriceDate(notice.row.effective_from)}</strong>, votre abonnement OZË PARIS passe à</>
                    : <>À partir du <strong className="text-gray-900">{formatPriceDate(notice.row.effective_from)}</strong>, votre abonnement OZË PARIS passe à</>}
                </p>
                <p className="mt-2 text-4xl font-bold tabular-nums text-gray-900">{formatMonthlyPrice(notice.row.monthly_price)}</p>
                {notice.previous !== null && notice.previous > 0 && (
                  <p className="mt-1 text-xs text-gray-400">au lieu de {formatMonthlyPrice(notice.previous)} actuellement</p>
                )}
                {cutoffWarning && (
                  <p className="mx-auto mt-3 max-w-md rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">{cutoffWarning}</p>
                )}
              </>
            )}
          </div>

          {message && (
            <div className="mt-6 rounded-xl border border-gray-100 bg-gray-50 px-5 py-4">
              <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-gray-800">{message}</p>
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
