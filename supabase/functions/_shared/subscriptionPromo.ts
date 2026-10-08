// Codes promo des abonnements Club B2B, gérés dans l'admin (table
// club_promo_codes, 0192). Saisis sur la page d'inscription, vérifiés ici ;
// au paiement, la remise est transmise à Stripe via un coupon créé
// automatiquement (ensureStripeCoupon). Le suivi par code (membres, CA) se
// fait sur b2b_subscription_payments.promo_code (0191).

import Stripe from 'https://esm.sh/stripe@17.7.0?target=deno';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { priceForPlan, type SubscriptionPlan } from './subscriptionCheckout.ts';

export interface ClubPromoCode {
  id: string;
  code: string;
  discount_type: 'percentage' | 'fixed_amount';
  discount_value: number;
  duration: 'once' | 'repeating' | 'forever';
  duration_months: number | null;
  plans: string[];
  max_uses: number | null;
  valid_until: string | null;
  status: 'active' | 'inactive';
}

export interface PromoPreview {
  code: string;
  /** Ex. « -20 % pendant 3 mois », « -10,00 € le premier mois ». */
  label: string;
  /** Montant du premier paiement après remise (€). */
  firstAmount: number;
  /** Prix normal du pass (€). */
  regularAmount: number;
}

const euros = (value: number) => value.toFixed(2).replace('.', ',') + ' €';

const durationLabel = (promo: ClubPromoCode): string => {
  if (promo.duration === 'forever') return 'chaque mois';
  const months = promo.duration === 'repeating' ? promo.duration_months || 1 : 1;
  return months === 1 ? 'le premier mois' : `pendant ${months} mois`;
};

/** Valide un code pour un pass ; lève une erreur lisible s'il est refusé. */
export async function resolveClubPromo(
  admin: SupabaseClient,
  stripe: Stripe,
  rawCode: string,
  plan: SubscriptionPlan,
): Promise<{ promo: ClubPromoCode; preview: PromoPreview }> {
  const code = rawCode.trim().toUpperCase();
  if (!code) throw new Error('Saisissez un code promo');
  const { data } = await admin.from('club_promo_codes').select('*').eq('code', code).maybeSingle();
  const promo = data as ClubPromoCode | null;
  if (!promo || promo.status !== 'active') throw new Error('Ce code promo n\'est pas valable');
  if (promo.valid_until && new Date(promo.valid_until).getTime() < Date.now()) throw new Error('Ce code promo a expiré');
  if (!promo.plans.includes(plan)) throw new Error('Ce code promo ne s\'applique pas à ce pass');
  if (promo.max_uses) {
    // Une utilisation = un client Stripe ayant payé au moins une échéance avec ce code.
    const { data: used } = await admin.from('b2b_subscription_payments').select('stripe_customer_id').eq('promo_code', promo.code);
    const customers = new Set((used || []).map((r) => r.stripe_customer_id));
    if (customers.size >= promo.max_uses) throw new Error('Ce code promo a atteint sa limite d\'utilisation');
  }

  const priceId = priceForPlan(plan);
  if (!priceId) throw new Error('Pass indisponible');
  const price = await stripe.prices.retrieve(priceId);
  const regular = (price.unit_amount ?? 0) / 100;
  const value = Number(promo.discount_value);
  const discount = promo.discount_type === 'percentage' ? Math.round(regular * value) / 100 : Math.min(regular, value);
  const amountLabel = promo.discount_type === 'percentage' ? `-${String(value).replace('.', ',')} %` : `-${euros(value)}`;
  return {
    promo,
    preview: {
      code: promo.code.toUpperCase(),
      label: `${amountLabel} ${durationLabel(promo)}`,
      firstAmount: Math.max(0, Math.round((regular - discount) * 100) / 100),
      regularAmount: regular,
    },
  };
}

/** Coupon Stripe portant la remise du code. Id déterministe dérivé des
 * conditions : réutilisé tant qu'elles ne changent pas, nouveau coupon sinon
 * (un coupon Stripe n'est pas modifiable). */
export async function ensureStripeCoupon(stripe: Stripe, promo: ClubPromoCode): Promise<string> {
  const value = Number(promo.discount_value);
  const months = promo.duration === 'repeating' ? promo.duration_months || 1 : 0;
  const terms = `${promo.discount_type === 'percentage' ? 'p' : 'a'}${String(value).replace('.', '_')}_${promo.duration}${months || ''}`;
  const couponId = `club_${promo.code.toUpperCase().replace(/[^A-Z0-9]/g, '')}_${terms}`.slice(0, 200);
  try {
    await stripe.coupons.retrieve(couponId);
    return couponId;
  } catch {
    await stripe.coupons.create({
      id: couponId,
      name: promo.code.toUpperCase(),
      ...(promo.discount_type === 'percentage'
        ? { percent_off: value }
        : { amount_off: Math.round(value * 100), currency: 'eur' }),
      duration: promo.duration,
      ...(promo.duration === 'repeating' ? { duration_in_months: months } : {}),
      metadata: { club_promo_code: promo.code.toUpperCase(), club_promo_code_id: promo.id },
    });
    return couponId;
  }
}
