import React, { useEffect, useState } from 'react';
import { AlertTriangle, CalendarX, CreditCard, RefreshCw, Send, Trash2, TrendingUp, UserX, Users } from 'lucide-react';
import { Card, CardContent } from '../../ui/Card';
import type { Reseller } from '../../../hooks/useResellers';
import { supabase } from '../../../lib/supabase';
import { invokeEdgeFunction } from '../../../utils/invokeEdgeFunction';
import { expectedMonthlyAmount, planPriceValue, type SubscriptionPromoData } from '../../../hooks/useSubscriptionPromos';

/**
 * Tableau de bord des abonnements Club B2B (section « Abonnés ») : abonnés
 * par pass, revenu mensuel estimé, résiliations et changements programmés,
 * paiements en échec, inscriptions jamais payées. Calculé depuis les
 * colonnes d'abonnement des revendeurs (tenues à jour par le webhook Stripe).
 * Le revenu est le montant du PROCHAIN prélèvement de chaque abonné, codes
 * promo Club (0192) déduits — voir useSubscriptionPromos.expectedMonthlyAmount.
 * « Abonnés payants » compte tous ceux qui paient : abonnés Club hors accès
 * gratuit, plus les membres des communautés partenaires abonnés à leur prix
 * de groupe (reseller_contacts.community_sub_*, 0214).
 */

type CommunityPayer = {
  id: string;
  community_sub_status: string;
  community_sub_price: number | null;
  community_sub_plan: string | null;
  community_sub_current_period_end: string | null;
  profile: { first_name: string | null; last_name: string | null; email: string | null } | null;
  reseller: { company_name: string } | null;
};

type PendingSignup = {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  plan: string;
  created_at: string;
  last_reminded_at: string | null;
  reminder_count: number | null;
};

const PREVIEW = 5;
/** Lien de reprise du paiement valable 30 jours après l'inscription (b2b-signup). */
const RESUME_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const ONGOING = new Set(['active', 'trialing', 'past_due']);

const EUR = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
const shortDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) : '—';

const Stat: React.FC<{ icon: React.ElementType; label: string; value: string; hint?: string; tone?: 'default' | 'warning' | 'danger' }> = ({
  icon: Icon, label, value, hint, tone = 'default',
}) => (
  <Card>
    <CardContent className="p-4">
      <div className="flex items-center gap-2 text-xs font-medium text-gray-500">
        <Icon className={`h-4 w-4 ${tone === 'danger' ? 'text-red-500' : tone === 'warning' ? 'text-amber-500' : 'text-gray-400'}`} />
        {label}
      </div>
      <p className={`mt-2 text-2xl font-semibold tabular-nums ${tone === 'danger' ? 'text-red-700' : tone === 'warning' ? 'text-amber-700' : 'text-gray-900'}`}>
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-gray-500">{hint}</p>}
    </CardContent>
  </Card>
);

export const SubscriptionStats: React.FC<{ subscribers: Reseller[]; promoData: SubscriptionPromoData | null }> = ({
  subscribers,
  promoData,
}) => {
  const paying = subscribers.filter((r) => r.status === 'active' && ONGOING.has(r.subscription_status || ''));
  const catalogueMrr = paying.filter((r) => r.subscription_plan === 'drops' || r.subscription_plan === 'revendeur').reduce(
    (sum, r) => sum + (Number(r.subscription_amount) || planPriceValue(r.subscription_plan === 'drops' ? 'drops' : 'revendeur')),
    0
  );
  // Tant que promoData est null (chargement / erreur), on retombe sur le prix catalogue.
  const expected = promoData ? paying.map((r) => expectedMonthlyAmount(r, promoData)) : null;
  const clubMrr = expected ? expected.reduce((sum, n) => sum + n, 0) : catalogueMrr;
  const freeCount = expected ? expected.filter((n) => n === 0).length : 0;
  // Abonnés Club qui paient vraiment (hors code 100 %).
  const clubPaying = expected ? paying.filter((_, i) => expected[i] > 0) : paying;
  const drops = clubPaying.filter((r) => r.subscription_plan === 'drops');
  const revendeur = clubPaying.filter((r) => r.subscription_plan === 'revendeur');

  // Membres des communautés partenaires abonnés (accompagnement d'Aurel…).
  const [communityPayers, setCommunityPayers] = useState<CommunityPayer[]>([]);
  const [showAllCommunity, setShowAllCommunity] = useState(false);
  useEffect(() => {
    supabase
      .from('reseller_contacts')
      .select('id, community_sub_status, community_sub_price, community_sub_plan, community_sub_current_period_end, profile:profiles(first_name, last_name, email), reseller:resellers(company_name)')
      .in('community_sub_status', [...ONGOING])
      .then(({ data, error }) => {
        if (error) return;
        const rows = (data || []) as unknown as CommunityPayer[];
        rows.sort((a, b) => (a.community_sub_current_period_end || '').localeCompare(b.community_sub_current_period_end || ''));
        setCommunityPayers(rows);
      });
  }, []);
  const communityMrr = communityPayers.reduce((sum, c) => sum + (Number(c.community_sub_price) || 0), 0);
  const communityCompanies = [...new Set(communityPayers.map((c) => c.reseller?.company_name).filter(Boolean))];

  const mrr = clubMrr + communityMrr;
  const mrrHint = [
    !expected ? 'au prix catalogue, hors promos' : clubMrr < catalogueMrr - 0.005 ? `codes promo déduits (catalogue ${EUR(catalogueMrr)})` : 'codes promo déduits',
    communityMrr > 0 ? `dont ${EUR(communityMrr)} communauté` : null,
  ].filter(Boolean).join(' · ');
  const cancelling = paying.filter((r) => r.subscription_cancel_at_period_end);
  const downgrading = paying.filter((r) => r.subscription_pending_plan === 'drops');
  const pastDue = paying.filter((r) => r.subscription_status === 'past_due');
  // Inscriptions jamais payées : en attente dans b2b_pending_signups (0175, aucun compte créé),
  // plus les anciens comptes créés avant paiement par la première version de l'inscription.
  const legacyNeverPaid = subscribers.filter((r) => r.status === 'pending' && !r.subscription_status).length;
  const [pendingSignups, setPendingSignups] = useState<PendingSignup[]>([]);
  const [signupBusy, setSignupBusy] = useState<string | null>(null);
  const [signupMessage, setSignupMessage] = useState<string | null>(null);
  const loadPendingSignups = () =>
    supabase
      .from('b2b_pending_signups')
      .select('id, email, first_name, last_name, plan, created_at, last_reminded_at, reminder_count')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (!error) setPendingSignups((data || []) as PendingSignup[]);
      });
  useEffect(() => {
    loadPendingSignups();
  }, []);
  const neverPaid = legacyNeverPaid + pendingSignups.length;
  const remindable = pendingSignups.filter((p) => Date.now() - new Date(p.created_at).getTime() <= RESUME_MAX_AGE_MS);

  const signupAction = async (action: 'remind' | 'delete', ids: string[], key: string) => {
    if (ids.length === 0) return;
    if (action === 'delete' && !window.confirm('Supprimer cette inscription non payée ? (test, doublon…)')) return;
    if (action === 'remind' && ids.length > 1 && !window.confirm(`Renvoyer l'email de relance à ${ids.length} personnes ?`)) return;
    setSignupBusy(key);
    setSignupMessage(null);
    const { data, error } = await invokeEdgeFunction<{ sent?: number; deleted?: number; expired?: string[] }>('admin-pending-signups', { action, signup_ids: ids });
    setSignupBusy(null);
    if (error || !data) {
      setSignupMessage(`Échec : ${error || 'erreur inconnue'}`);
      return;
    }
    setSignupMessage(
      action === 'delete'
        ? 'Inscription supprimée.'
        : `${data.sent || 0} relance${(data.sent || 0) > 1 ? 's' : ''} envoyée${(data.sent || 0) > 1 ? 's' : ''}${data.expired?.length ? ` · lien expiré pour ${data.expired.join(', ')}` : ''}`
    );
    loadPendingSignups();
  };

  // Rattrapage du CA des abonnements (0185) : relit chez Stripe les factures
  // payées des abonnés. Le webhook enregistre ensuite chaque nouveau paiement.
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const syncPayments = async () => {
    setSyncing(true);
    setSyncMessage(null);
    const { data, error } = await supabase.functions.invoke('sync-subscription-payments');
    setSyncing(false);
    setSyncMessage(error || data?.error
      ? `Échec : ${data?.error || error?.message}`
      : `${data.recorded} paiement${data.recorded > 1 ? 's' : ''} enregistré${data.recorded > 1 ? 's' : ''} (${data.subscribers} abonné${data.subscribers > 1 ? 's' : ''})`);
  };
  const ended = subscribers.filter((r) => r.status === 'suspended' && !ONGOING.has(r.subscription_status || ''));

  const upcoming = [...cancelling, ...downgrading, ...pastDue]
    .filter((r, i, all) => all.findIndex((x) => x.id === r.id) === i)
    .sort((a, b) => (a.subscription_current_period_end || '').localeCompare(b.subscription_current_period_end || ''));

  return (
    <div className="mb-6 space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          icon={Users}
          label="Abonnés payants"
          value={String(clubPaying.length + communityPayers.length)}
          hint={[
            `${revendeur.length} Revendeur · ${drops.length} Drops`,
            communityPayers.length ? `${communityPayers.length} communauté` : null,
            freeCount ? `+ ${freeCount} gratuit${freeCount > 1 ? 's' : ''} non compté${freeCount > 1 ? 's' : ''}` : null,
          ].filter(Boolean).join(' · ')}
        />
        <Stat icon={TrendingUp} label="Revenu mensuel estimé" value={EUR(mrr)} hint={mrrHint} />
        <Stat
          icon={CalendarX}
          label="Résiliations programmées"
          value={String(cancelling.length)}
          hint={downgrading.length ? `+ ${downgrading.length} passage${downgrading.length > 1 ? 's' : ''} au Pass Drops` : 'accès coupé à l\'échéance'}
          tone={cancelling.length ? 'warning' : 'default'}
        />
        <Stat
          icon={CreditCard}
          label="Paiements en échec"
          value={String(pastDue.length)}
          hint="Stripe retente le prélèvement"
          tone={pastDue.length ? 'danger' : 'default'}
        />
      </div>

      {communityPayers.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <p className="mb-3 flex flex-wrap items-center gap-2 text-sm font-semibold text-gray-900">
              <Users className="h-4 w-4 text-gray-400" />
              Membres payants des communautés ({communityPayers.length})
              <span className="text-xs font-normal text-gray-500">
                {communityCompanies.join(', ')} · {EUR(communityMrr)} / mois
              </span>
            </p>
            <ul className="divide-y divide-gray-100">
              {(showAllCommunity ? communityPayers : communityPayers.slice(0, PREVIEW)).map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span className="min-w-0 truncate text-gray-900">
                    {[c.profile?.first_name, c.profile?.last_name].filter(Boolean).join(' ') || c.profile?.email || 'Membre'}
                    <span className="ml-2 text-xs text-gray-500">{c.profile?.email}</span>
                    {c.reseller?.company_name && <span className="ml-2 text-xs text-gray-400">· {c.reseller.company_name}</span>}
                  </span>
                  <span className="text-xs text-gray-600">
                    <span className="font-medium text-gray-900">{EUR(Number(c.community_sub_price) || 0)}</span>
                    {c.community_sub_plan === 'drops' ? ' · Drops' : ''}
                    {c.community_sub_status === 'past_due' ? (
                      <span className="ml-2 font-medium text-red-700">Paiement en échec</span>
                    ) : c.community_sub_current_period_end ? (
                      <span className="ml-2 text-gray-500">renouvellement le {shortDate(c.community_sub_current_period_end)}</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
            {communityPayers.length > PREVIEW && (
              <button
                type="button"
                onClick={() => setShowAllCommunity((v) => !v)}
                className="mt-2 text-sm font-medium text-gray-600 hover:text-gray-900"
              >
                {showAllCommunity ? 'Afficher moins' : `Afficher plus (${communityPayers.length - PREVIEW})`}
              </button>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent className="p-4">
            <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
              <AlertTriangle className="h-4 w-4 text-amber-500" /> À surveiller
            </p>
            {upcoming.length === 0 ? (
              <p className="text-sm text-gray-500">Aucune résiliation, aucun changement de pass ni impayé en cours.</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {upcoming.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <span className="min-w-0 truncate text-gray-900">
                      {r.company_name}
                      <span className="ml-2 text-xs text-gray-500">{r.contact_email}</span>
                    </span>
                    <span className={`text-xs font-medium ${r.subscription_status === 'past_due' ? 'text-red-700' : 'text-amber-700'}`}>
                      {r.subscription_status === 'past_due'
                        ? 'Paiement en échec'
                        : r.subscription_cancel_at_period_end
                          ? `Résiliation le ${shortDate(r.subscription_current_period_end)}`
                          : `Pass Drops le ${shortDate(r.subscription_current_period_end)}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-3 p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-gray-900">
              <UserX className="h-4 w-4 text-gray-400" /> Hors abonnement
            </p>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600">Inscriptions non payées</span>
              <span className="font-semibold tabular-nums text-gray-900">{neverPaid}</span>
            </div>
            {pendingSignups.length > 0 && (
              <ul className="space-y-1.5">
                {pendingSignups.map((p) => {
                  const expired = Date.now() - new Date(p.created_at).getTime() > RESUME_MAX_AGE_MS;
                  return (
                    <li key={p.id} className="rounded-lg bg-gray-50 px-2.5 py-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium text-gray-900">
                            {p.first_name} {p.last_name}
                            <span className="ml-1 font-normal text-gray-500">· {p.plan === 'drops' ? 'Pass Drops' : 'Pass Revendeur'}</span>
                          </p>
                          <p className="truncate text-[11px] text-gray-500">{p.email}</p>
                          <p className="text-[11px] text-gray-400">
                            Inscrit le {shortDate(p.created_at)}
                            {p.last_reminded_at ? ` · relancé le ${shortDate(p.last_reminded_at)}${(p.reminder_count || 0) > 1 ? ` (${p.reminder_count}×)` : ''}` : ''}
                          </p>
                        </div>
                        <div className="flex flex-shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() => signupAction('remind', [p.id], p.id)}
                            disabled={signupBusy !== null || expired}
                            title={expired ? 'Lien de paiement expiré (plus de 30 jours) : la personne doit recommencer son inscription' : "Renvoyer l'email avec le lien pour finaliser le paiement"}
                            className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-40"
                          >
                            <Send className="h-3 w-3" /> {signupBusy === p.id ? '…' : 'Relancer'}
                          </button>
                          <button
                            type="button"
                            onClick={() => signupAction('delete', [p.id], `del-${p.id}`)}
                            disabled={signupBusy !== null}
                            title="Supprimer cette inscription (test, doublon…)"
                            className="rounded-md p-1 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {remindable.length > 1 && (
              <button
                type="button"
                onClick={() => signupAction('remind', remindable.map((p) => p.id), 'all')}
                disabled={signupBusy !== null}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-700 hover:text-gray-900 disabled:opacity-50"
              >
                <Send className="h-3.5 w-3.5" /> {signupBusy === 'all' ? 'Envoi…' : `Relancer tout le monde (${remindable.length})`}
              </button>
            )}
            {signupMessage && <p className="text-xs text-gray-600">{signupMessage}</p>}
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600">Abonnements terminés</span>
              <span className="font-semibold tabular-nums text-gray-900">{ended.length}</span>
            </div>
            <p className="text-xs text-gray-500">Une relance automatique part par email quand la page de paiement expire ; « Relancer » renvoie le même email.</p>
            <div className="border-t border-gray-100 pt-3">
              <button
                type="button"
                onClick={syncPayments}
                disabled={syncing}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-700 hover:text-gray-900 disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
                Synchroniser les paiements (CA)
              </button>
              {syncMessage && <p className="mt-1 text-xs text-gray-500">{syncMessage}</p>}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default SubscriptionStats;
