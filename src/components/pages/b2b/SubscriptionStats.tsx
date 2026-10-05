import React, { useEffect, useState } from 'react';
import { AlertTriangle, CalendarX, CreditCard, RefreshCw, TrendingUp, UserX, Users } from 'lucide-react';
import { Card, CardContent } from '../../ui/Card';
import type { Reseller } from '../../../hooks/useResellers';
import { PLANS } from '../../landing/plans';
import { supabase } from '../../../lib/supabase';

/**
 * Tableau de bord des abonnements Club B2B (section « Abonnés ») : abonnés
 * par pass, revenu mensuel estimé, résiliations et changements programmés,
 * paiements en échec, inscriptions jamais payées. Calculé depuis les
 * colonnes d'abonnement des revendeurs (tenues à jour par le webhook Stripe).
 * Le revenu est une estimation au prix catalogue (hors codes promo).
 */

const ONGOING = new Set(['active', 'trialing', 'past_due']);

const planPriceValue = (id: 'drops' | 'revendeur') => {
  const raw = PLANS.find((p) => p.id === id)?.price || '0';
  return Number(raw.replace(/[^\d,]/g, '').replace(',', '.')) || 0;
};

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

export const SubscriptionStats: React.FC<{ subscribers: Reseller[] }> = ({ subscribers }) => {
  const paying = subscribers.filter((r) => r.status === 'active' && ONGOING.has(r.subscription_status || ''));
  const drops = paying.filter((r) => r.subscription_plan === 'drops');
  const revendeur = paying.filter((r) => r.subscription_plan === 'revendeur');
  const mrr = drops.length * planPriceValue('drops') + revendeur.length * planPriceValue('revendeur');
  const cancelling = paying.filter((r) => r.subscription_cancel_at_period_end);
  const downgrading = paying.filter((r) => r.subscription_pending_plan === 'drops');
  const pastDue = paying.filter((r) => r.subscription_status === 'past_due');
  // Inscriptions jamais payées : en attente dans b2b_pending_signups (0175, aucun compte créé),
  // plus les anciens comptes créés avant paiement par la première version de l'inscription.
  const legacyNeverPaid = subscribers.filter((r) => r.status === 'pending' && !r.subscription_status).length;
  const [pendingSignups, setPendingSignups] = useState(0);
  useEffect(() => {
    supabase
      .from('b2b_pending_signups')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .then(({ count, error }) => {
        if (!error) setPendingSignups(count ?? 0);
      });
  }, []);
  const neverPaid = legacyNeverPaid + pendingSignups;

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
        <Stat icon={Users} label="Abonnés payants" value={String(paying.length)} hint={`${revendeur.length} Revendeur · ${drops.length} Drops`} />
        <Stat icon={TrendingUp} label="Revenu mensuel estimé" value={EUR(mrr)} hint="au prix catalogue, hors promos" />
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
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600">Abonnements terminés</span>
              <span className="font-semibold tabular-nums text-gray-900">{ended.length}</span>
            </div>
            <p className="text-xs text-gray-500">Les inscriptions non payées reçoivent une relance automatique par email.</p>
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
