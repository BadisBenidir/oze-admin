import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Reseller } from './useResellers';
import { PLANS } from '../components/landing/plans';

/**
 * Codes promo Club (0192) réellement appliqués aux abonnés, déduits de leurs
 * échéances payées (b2b_subscription_payments.promo_code, 0191). Partagé par
 * la liste des abonnés (badge « gratuit à vie ») et SubscriptionStats (revenu
 * mensuel estimé) : une seule lecture pour la page.
 */

export interface SubscriptionPaymentRow {
  reseller_id: string | null;
  stripe_subscription_id: string | null;
  amount: number;
  discount_amount: number;
  promo_code: string | null;
  paid_at: string;
}

export interface ClubPromoTerms {
  code: string;
  discount_type: 'percentage' | 'fixed_amount';
  discount_value: number;
  duration: 'once' | 'repeating' | 'forever';
  duration_months: number | null;
}

export interface SubscriptionPromoData {
  payments: SubscriptionPaymentRow[];
  promos: Map<string, ClubPromoTerms>;
}

export const planPriceValue = (id: 'drops' | 'revendeur') => {
  const raw = PLANS.find((p) => p.id === id)?.price || '0';
  return Number(raw.replace(/[^\d,]/g, '').replace(',', '.')) || 0;
};

const paymentsOf = (r: Reseller, payments: SubscriptionPaymentRow[]) =>
  payments
    .filter((p) => p.reseller_id === r.id || (r.stripe_subscription_id && p.stripe_subscription_id === r.stripe_subscription_id))
    .sort((a, b) => b.paid_at.localeCompare(a.paid_at));

/**
 * Montant mensuel attendu d'un abonné : prix catalogue du pass, moins la
 * remise du code promo de sa dernière échéance SI elle s'applique encore au
 * prochain prélèvement — « forever » toujours (100 % → 0 €, 15 % → 85 % du
 * prix), « repeating » tant que le nombre d'échéances payées avec ce code est
 * inférieur à duration_months, « once » jamais (déjà consommée). Une remise
 * posée depuis le Dashboard Stripe (« coupon:… », conditions inconnues ici)
 * est supposée reconduite : on reprend le montant réellement payé.
 */
export const expectedMonthlyAmount = (r: Reseller, { payments, promos }: SubscriptionPromoData): number => {
  // Prix de SON abonnement (ancien tarif conservé après une hausse), sinon prix public.
  const catalogue = Number(r.subscription_amount) || planPriceValue(r.subscription_plan === 'drops' ? 'drops' : 'revendeur');
  const own = paymentsOf(r, payments);
  const latest = own[0];
  if (!latest?.promo_code) return catalogue;

  const promo = promos.get(latest.promo_code.toUpperCase());
  if (!promo) return Number(latest.discount_amount) > 0 ? Number(latest.amount) || 0 : catalogue;
  if (promo.duration === 'once') return catalogue;
  if (promo.duration === 'repeating') {
    const used = own.filter((p) => p.promo_code?.toUpperCase() === promo.code.toUpperCase()).length;
    if (used >= (promo.duration_months || 1)) return catalogue;
  }
  const value = Number(promo.discount_value) || 0;
  const discounted = promo.discount_type === 'percentage' ? catalogue * (1 - value / 100) : catalogue - value;
  return Math.max(0, Math.round(discounted * 100) / 100);
};

/** Code promo « à vie » qui rend le pass gratuit (100 %, ou remise fixe
 * couvrant tout le prix) — null pour toute autre remise (-15 % à vie,
 * premier mois offert, N mois…). */
export const lifetimeFreeCode = (r: Reseller, data: SubscriptionPromoData): string | null => {
  const latest = paymentsOf(r, data.payments)[0];
  const promo = latest?.promo_code ? data.promos.get(latest.promo_code.toUpperCase()) : undefined;
  if (!promo || promo.duration !== 'forever') return null;
  return expectedMonthlyAmount(r, data) === 0 ? promo.code.toUpperCase() : null;
};

/** null tant que le chargement n'a pas abouti (ou en cas d'erreur). */
export const useSubscriptionPromos = (enabled = true): SubscriptionPromoData | null => {
  const [data, setData] = useState<SubscriptionPromoData | null>(null);
  useEffect(() => {
    if (!enabled) return;
    Promise.all([
      supabase
        .from('b2b_subscription_payments')
        .select('reseller_id, stripe_subscription_id, amount, discount_amount, promo_code, paid_at'),
      supabase.from('club_promo_codes').select('code, discount_type, discount_value, duration, duration_months'),
    ]).then(([paymentsRes, promosRes]) => {
      if (paymentsRes.error) return;
      setData({
        payments: (paymentsRes.data || []) as SubscriptionPaymentRow[],
        promos: new Map(
          (promosRes.error ? [] : (promosRes.data || []) as ClubPromoTerms[]).map((p) => [p.code.toUpperCase(), p])
        ),
      });
    });
  }, [enabled]);
  return data;
};
