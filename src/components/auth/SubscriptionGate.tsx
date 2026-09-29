import React, { useEffect, useState } from 'react';
import { AlertCircle, Check, CreditCard, LogOut, RotateCcw } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { invokeEdgeFunction } from '../../utils/invokeEdgeFunction';
import { PERIOD, PLANS, type SignupPlanId } from '../landing/plans';
import logo from '../landing/assets/logo_oze_paris_b2b.png';

/**
 * Page affichée à la place de l'espace pro pour un abonné (0167) dont
 * l'abonnement est terminé, ou qui s'est inscrit sans finaliser le paiement.
 * Ses infos (celles du premier abonnement) sont affichées grisées : il ne fait
 * que choisir son pass et payer. Le webhook réactive le MÊME revendeur —
 * statut juridique, point relais, commandes et solde sont conservés.
 *
 * Rend `fallback` (écran « compte suspendu » etc.) pour tout autre cas :
 * entreprise, suspension manuelle par l'admin, erreur de lecture.
 */

type State = {
  account_type: string;
  status: string;
  subscription_plan: SignupPlanId | null;
  subscription_status: string | null;
  subscription_current_period_end: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  billing_address: string | null;
  billing_postal_code: string | null;
  billing_city: string | null;
  billing_country: string | null;
};

/** Statuts Stripe d'un abonnement encore en cours : pas de réabonnement dans ce cas. */
const ONGOING = new Set(['active', 'trialing', 'past_due']);

const needsCheckout = (s: State | null) =>
  !!s &&
  s.account_type === 'subscriber' &&
  (s.status === 'pending' || (s.status === 'suspended' && !ONGOING.has(s.subscription_status || '')));

const fetchState = async (): Promise<State | null> => {
  const { data, error } = await supabase.rpc('get_my_subscription_state');
  if (error) return null;
  return ((Array.isArray(data) ? data[0] : data) as State) || null;
};

const ReadOnly: React.FC<{ label: string; value: string | null | undefined; wide?: boolean }> = ({ label, value, wide }) => (
  <div className={wide ? 'sm:col-span-2' : ''}>
    <label className="mb-1 block text-xs font-medium text-gray-500">{label}</label>
    <input
      value={value || '—'}
      readOnly
      disabled
      className="w-full cursor-not-allowed border border-gray-200 bg-gray-100 px-3 py-2.5 text-sm text-gray-500"
    />
  </div>
);

export const SubscriptionGate: React.FC<{ fallback: React.ReactNode; onSignOut: () => void }> = ({ fallback, onSignOut }) => {
  const [state, setState] = useState<State | null>(null);
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<SignupPlanId>('revendeur');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const returningFromPayment = new URLSearchParams(window.location.search).get('abonnement') === 'ok';

  useEffect(() => {
    let cancelled = false;
    fetchState().then((s) => {
      if (cancelled) return;
      setState(s);
      if (s?.subscription_plan) setPlan(s.subscription_plan);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Retour de Stripe : le webhook active le compte en quelques secondes.
  useEffect(() => {
    if (!returningFromPayment || loading) return;
    if (state?.status === 'active') {
      window.location.replace('/catalogue');
      return;
    }
    const timer = setInterval(async () => {
      const s = await fetchState();
      if (s?.status === 'active') window.location.replace('/catalogue');
    }, 3000);
    return () => clearInterval(timer);
  }, [returningFromPayment, loading, state?.status]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-gray-900 border-t-transparent" />
      </div>
    );
  }

  if (!needsCheckout(state) && !returningFromPayment) return <>{fallback}</>;

  const handleCheckout = async () => {
    setSubmitting(true);
    setError(null);
    const { data, error: err } = await invokeEdgeFunction<{ url: string }>('b2b-subscription', { action: 'checkout', plan });
    if (data?.url) {
      window.location.href = data.url;
      return;
    }
    setError(err || 'Impossible d\'ouvrir le paiement, réessayez.');
    setSubmitting(false);
  };

  const neverPaid = state?.status === 'pending' && !state.subscription_status;
  const endedOn = state?.subscription_current_period_end
    ? new Date(state.subscription_current_period_end).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;
  const selected = PLANS.find((p) => p.id === plan)!;
  const signupPlans = PLANS.filter((p) => p.id === 'drops' || p.id === 'revendeur');

  return (
    <div className="min-h-screen text-sm" style={{ background: 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)' }}>
      <div className="sticky top-0 z-40 border-b border-gray-200 bg-white shadow-sm">
        <div className="relative mx-auto flex h-14 max-w-4xl items-center justify-between px-4 sm:px-6">
          <span />
          <img src={logo} alt="OZË Paris — B2B Solutions" className="absolute left-1/2 h-9 w-auto -translate-x-1/2" />
          <button onClick={onSignOut} className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-900">
            <LogOut className="h-4 w-4" /> <span className="hidden sm:inline">Se déconnecter</span>
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        {returningFromPayment ? (
          <div className="rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
            <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-gray-900 border-t-transparent" />
            <h1 className="mt-5 text-lg font-bold text-gray-900">Paiement reçu, activation de votre espace…</h1>
            <p className="mt-2 text-gray-600">Cela prend quelques secondes, la page s'ouvrira automatiquement.</p>
          </div>
        ) : (
          <>
            <div className="mb-6 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-gray-900 text-white">
                {neverPaid ? <CreditCard className="h-6 w-6" /> : <RotateCcw className="h-6 w-6" />}
              </div>
              <h1 className="mt-4 text-xl font-bold text-gray-900 sm:text-2xl">
                {neverPaid ? 'Finalisez votre abonnement' : 'Votre abonnement a été résilié'}
              </h1>
              <p className="mx-auto mt-2 max-w-lg text-gray-600">
                {neverPaid
                  ? 'Votre compte est créé mais le paiement n\'a pas été finalisé. Choisissez votre pass pour accéder à votre espace.'
                  : `${endedOn ? `Votre accès a pris fin le ${endedOn}. ` : ''}Réabonnez-vous pour retrouver votre espace tel que vous l'avez laissé : statut juridique, point relais favori, commandes et solde sont conservés.`}
              </p>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
              <div className="space-y-5 lg:col-span-7">
                <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                  <div className="border-b border-gray-100 p-4 sm:p-5">
                    <h2 className="text-base font-semibold text-gray-900">Vos informations</h2>
                    <p className="mt-1 text-xs text-gray-500">
                      Celles de votre inscription. Pour les modifier, contactez OZË Paris.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 sm:p-5">
                    <ReadOnly label="Prénom" value={state?.first_name} />
                    <ReadOnly label="Nom" value={state?.last_name} />
                    <ReadOnly label="Email" value={state?.email} />
                    <ReadOnly label="Téléphone" value={state?.phone} />
                    <ReadOnly
                      wide
                      label="Adresse de facturation"
                      value={[state?.billing_address, [state?.billing_postal_code, state?.billing_city].filter(Boolean).join(' '), state?.billing_country]
                        .filter(Boolean)
                        .join(', ')}
                    />
                  </div>
                </div>
              </div>

              <div className="lg:col-span-5">
                <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                  <div className="border-b border-gray-100 p-4 sm:p-5">
                    <h2 className="text-base font-semibold text-gray-900">Votre pass</h2>
                  </div>
                  <div className="space-y-4 p-4 sm:p-5">
                    <div className="grid grid-cols-2 gap-1.5 rounded-lg bg-gray-100 p-1">
                      {signupPlans.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setPlan(p.id as SignupPlanId)}
                          className={`rounded-md py-1.5 text-xs font-medium transition-colors sm:text-sm ${
                            p.id === plan ? 'bg-white text-black shadow-sm' : 'text-gray-500 hover:text-gray-800'
                          }`}
                        >
                          {p.name}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-baseline justify-between">
                      <span className="font-semibold text-gray-900">{selected.name}</span>
                      <span className="font-semibold text-gray-900">
                        {selected.price} <span className="text-xs font-normal text-gray-500">{PERIOD}</span>
                      </span>
                    </div>
                    <ul className="space-y-2">
                      {selected.features.map((f) => (
                        <li
                          key={f.label}
                          className={`flex items-start gap-2 text-xs sm:text-sm ${f.included ? 'text-gray-700' : 'text-gray-300 line-through'}`}
                        >
                          <Check className={`mt-0.5 h-3.5 w-3.5 flex-shrink-0 ${f.included ? 'text-gray-900' : 'opacity-0'}`} />
                          {f.label}
                        </li>
                      ))}
                    </ul>

                    {error && (
                      <p className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-red-700">
                        <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" /> {error}
                      </p>
                    )}

                    <button
                      onClick={handleCheckout}
                      disabled={submitting}
                      className="flex w-full items-center justify-center gap-2 bg-black py-3 font-medium text-white transition-colors hover:bg-gray-800 disabled:opacity-60"
                    >
                      <CreditCard className="h-4 w-4" />
                      {submitting ? 'Ouverture du paiement…' : neverPaid ? 'Finaliser mon abonnement' : 'Me réabonner'}
                    </button>
                    <p className="text-center text-xs text-gray-500">Sans engagement · paiement sécurisé par Stripe</p>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
