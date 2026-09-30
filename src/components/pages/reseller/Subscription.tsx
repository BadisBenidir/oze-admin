import React, { useEffect, useState } from 'react';
import { AlertCircle, ArrowUpCircle, CalendarClock, Check, CreditCard, Download, ExternalLink, FileText, Gavel, Lock, PackageSearch } from 'lucide-react';
import { Card, CardContent } from '../../ui/Card';
import { invokeEdgeFunction } from '../../../utils/invokeEdgeFunction';
import type { ResellerProfile } from '../../../hooks/useResellerAuth';
import { PERIOD, PLANS } from '../../landing/plans';

/**
 * Abonnements Club B2B (0167) côté abonné : écran « non inclus dans votre
 * pass » (enchères / sourcing en Pass Drops) et section « Mon abonnement »
 * du profil. Les actions passent par l'Edge Function b2b-subscription.
 */

const PLAN_NAME = { drops: 'Pass Drops', revendeur: 'Pass Revendeur' } as const;
const planPrice = (id: 'drops' | 'revendeur') => PLANS.find((p) => p.id === id)?.price || '';

const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : null;

type Action = 'upgrade' | 'cancel' | 'resume';

/** Appelle b2b-subscription puis recharge l'app : useResellerAuth n'est pas
 * partagé entre composants, un rechargement garantit que menu, écrans et
 * droits reflètent immédiatement le nouveau pass. */
const useSubscriptionAction = () => {
  const [pending, setPending] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: Action) => {
    setPending(action);
    setError(null);
    const { error: err } = await invokeEdgeFunction('b2b-subscription', { action });
    if (err) {
      setError(err);
      setPending(null);
      return;
    }
    window.location.reload();
  };
  return { pending, error, run };
};

const UpgradeButton: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { pending, error, run } = useSubscriptionAction();
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className={`inline-flex items-center justify-center gap-2 rounded-lg bg-gray-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-gray-800 ${className}`}
      >
        <ArrowUpCircle className="h-4 w-4" /> Passer au Pass Revendeur
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4 text-left">
      <p className="text-sm text-gray-700">
        La différence entre vos deux pass est prélevée <strong>maintenant</strong>, au prorata des jours restants de votre
        mois, sur la carte de votre abonnement. Ensuite, {planPrice('revendeur')} {PERIOD}.
      </p>
      {error && (
        <p className="flex items-start gap-2 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" /> {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => run('upgrade')}
          disabled={pending !== null}
          className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {pending ? 'Paiement en cours…' : 'Confirmer et payer la différence'}
        </button>
        <button
          onClick={() => setConfirming(false)}
          disabled={pending !== null}
          className="rounded-lg bg-white px-4 py-2 text-sm text-gray-700 ring-1 ring-gray-200 hover:bg-gray-100 disabled:opacity-50"
        >
          Annuler
        </button>
      </div>
    </div>
  );
};

/** Écran affiché à la place des Enchères / du Sourcing pour un abonné Pass Drops. */
export const PlanLockedScreen: React.FC<{ feature: 'auctions' | 'sourcing' }> = ({ feature }) => {
  const Icon = feature === 'auctions' ? Gavel : PackageSearch;
  const title = feature === 'auctions' ? 'Enchères B2B' : 'Sourcing sur mesure';
  const text =
    feature === 'auctions'
      ? 'Les sessions d\'enchères privées, avec des lots dès 0 €, sont réservées au Pass Revendeur.'
      : 'Le sourcing sur mesure, avec un accompagnateur dédié qui sélectionne vos pièces avec vous, est réservé au Pass Revendeur.';

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-12">
      <Card>
        <CardContent className="p-8 text-center">
          <div className="relative mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-900 text-white">
            <Icon className="h-7 w-7" />
            <span className="absolute -bottom-1.5 -right-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-white ring-2 ring-gray-100">
              <Lock className="h-3.5 w-3.5 text-gray-700" />
            </span>
          </div>
          <h3 className="mt-5 text-lg font-semibold text-gray-900">{title} : non inclus dans votre Pass Drops</h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-gray-600">{text}</p>
          <ul className="mx-auto mt-6 max-w-xs space-y-2 text-left text-sm text-gray-700">
            {PLANS.find((p) => p.id === 'revendeur')?.features.map((f) => (
              <li key={f.label} className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-900" /> {f.label}
              </li>
            ))}
          </ul>
          <div className="mt-6 flex justify-center">
            <UpgradeButton />
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

interface SubscriptionInvoice {
  id: string;
  number: string | null;
  created: string;
  period_start: string | null;
  period_end: string | null;
  amount: number;
  currency: string;
  status: string;
  hosted_invoice_url: string | null;
  invoice_pdf: string | null;
}

const monthLabel = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

/** Toutes les factures Stripe de l'abonnement (b2b-subscription, action "invoices"). */
const InvoicesList: React.FC = () => {
  const [invoices, setInvoices] = useState<SubscriptionInvoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    invokeEdgeFunction<{ invoices: SubscriptionInvoice[] }>('b2b-subscription', { action: 'invoices' }).then(({ data, error: err }) => {
      if (cancelled) return;
      if (err) setError(err);
      setInvoices(data?.invoices ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="border-t border-gray-100 pt-4">
      <h5 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-gray-900">
        <FileText className="h-4 w-4 text-gray-400" /> Mes factures
      </h5>
      {invoices === null ? (
        <div className="space-y-2">
          {[0, 1].map((i) => <div key={i} className="h-10 animate-pulse rounded-lg bg-gray-100" />)}
        </div>
      ) : error ? (
        <p className="text-sm text-red-700">Impossible de charger vos factures : {error}</p>
      ) : invoices.length === 0 ? (
        <p className="text-sm text-gray-500">Aucune facture pour l'instant.</p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100">
          {invoices.map((inv) => (
            <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-medium capitalize text-gray-900">{monthLabel(inv.period_start || inv.created)}</p>
                <p className="text-xs text-gray-500">
                  {inv.number ? `N° ${inv.number} · ` : ''}
                  {new Date(inv.created).toLocaleDateString('fr-FR')}
                  {inv.status !== 'paid' && <span className="ml-1 font-medium text-amber-700">· en attente de paiement</span>}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold tabular-nums text-gray-900">
                  {inv.amount.toLocaleString('fr-FR', { style: 'currency', currency: inv.currency.toUpperCase() })}
                </span>
                {inv.invoice_pdf && (
                  <a
                    href={inv.invoice_pdf}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                  >
                    <Download className="h-3.5 w-3.5" /> PDF
                  </a>
                )}
                {inv.hosted_invoice_url && (
                  <a
                    href={inv.hosted_invoice_url}
                    target="_blank"
                    rel="noreferrer"
                    title="Voir la facture en ligne"
                    className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-50 hover:text-gray-700"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

/** Section « Mon abonnement » du profil (abonnés uniquement). */
export const SubscriptionSection: React.FC<{ profile: ResellerProfile }> = ({ profile }) => {
  const { pending, error, run } = useSubscriptionAction();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const plan = profile.subscription_plan;
  if (profile.account_type !== 'subscriber' || !plan) return null;

  const endDate = formatDate(profile.subscription_current_period_end);
  const cancelling = profile.subscription_cancel_at_period_end;

  return (
    <Card className="mb-6">
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h4 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
              <CreditCard className="h-4 w-4 text-gray-400" /> Mon abonnement
            </h4>
            <p className="mt-2 text-base font-semibold text-gray-900">{PLAN_NAME[plan]}</p>
            <p className="text-sm text-gray-500">
              {planPrice(plan)} {PERIOD} · sans engagement
            </p>
          </div>
          {cancelling ? (
            <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800 ring-1 ring-amber-200">
              Résiliation programmée
            </span>
          ) : (
            <span className="rounded-full bg-green-50 px-3 py-1 text-xs font-medium text-green-700 ring-1 ring-green-200">
              Actif
            </span>
          )}
        </div>

        {endDate && (
          <p className="flex items-center gap-2 text-sm text-gray-600">
            <CalendarClock className="h-4 w-4 text-gray-400" />
            {cancelling
              ? <>Votre accès reste ouvert jusqu'au <strong className="text-gray-900">{endDate}</strong>, puis sera coupé.</>
              : <>Prochain renouvellement le <strong className="text-gray-900">{endDate}</strong>.</>}
          </p>
        )}

        {error && (
          <p className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" /> {error}
          </p>
        )}

        <div className="flex flex-wrap items-start gap-3 border-t border-gray-100 pt-4">
          {plan === 'drops' && !cancelling && <UpgradeButton />}

          {cancelling ? (
            <button
              onClick={() => run('resume')}
              disabled={pending !== null}
              className="rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {pending === 'resume' ? 'Un instant…' : 'Annuler la résiliation'}
            </button>
          ) : confirmCancel ? (
            <div className="w-full space-y-3 rounded-lg border border-red-100 bg-red-50/50 p-4">
              <p className="text-sm text-gray-700">
                Votre abonnement ne sera pas renouvelé. Vous gardez l'accès jusqu'au {endDate || 'terme de la période payée'},
                puis votre compte sera désactivé.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => run('cancel')}
                  disabled={pending !== null}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {pending === 'cancel' ? 'Résiliation…' : 'Confirmer la résiliation'}
                </button>
                <button
                  onClick={() => setConfirmCancel(false)}
                  disabled={pending !== null}
                  className="rounded-lg bg-white px-4 py-2 text-sm text-gray-700 ring-1 ring-gray-200 hover:bg-gray-100"
                >
                  Garder mon abonnement
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setConfirmCancel(true)}
              className="rounded-lg px-4 py-2.5 text-sm text-gray-500 underline-offset-2 hover:text-red-600 hover:underline"
            >
              Résilier mon abonnement
            </button>
          )}
        </div>

        <InvoicesList />
      </CardContent>
    </Card>
  );
};
