// Codes promo des abonnements Club B2B : codes promotionnels Stripe
// (Dashboard Stripe → Produits → Coupons → Codes promotionnels). Saisis sur la
// page d'inscription, validés ici puis appliqués à la session Checkout
// (discounts). Le suivi par code (membres, CA) se fait sur
// b2b_subscription_payments.promo_code (0191).

import Stripe from 'https://esm.sh/stripe@17.7.0?target=deno';
import { priceForPlan, type SubscriptionPlan } from './subscriptionCheckout.ts';

export interface PromoPreview {
  promotionCodeId: string;
  code: string;
  /** Ex. « -20 % pendant 3 mois », « -10,00 € le premier mois ». */
  label: string;
  /** Montant du premier paiement après remise (€). */
  firstAmount: number;
  /** Prix normal du pass (€). */
  regularAmount: number;
}

const euros = (cents: number) => (cents / 100).toFixed(2).replace('.', ',') + ' €';

const durationLabel = (coupon: Stripe.Coupon): string => {
  if (coupon.duration === 'forever') return 'chaque mois';
  if (coupon.duration === 'once') return 'le premier mois';
  const months = coupon.duration_in_months || 1;
  return months === 1 ? 'le premier mois' : `pendant ${months} mois`;
};

/** Valide un code promo pour un pass ; lève une erreur lisible s'il est refusé. */
export async function resolvePromotionCode(stripe: Stripe, rawCode: string, plan: SubscriptionPlan): Promise<PromoPreview> {
  const code = rawCode.trim();
  if (!code) throw new Error('Saisissez un code promo');
  const { data } = await stripe.promotionCodes.list({ code, active: true, limit: 1, expand: ['data.coupon.applies_to'] });
  const promo = data[0];
  if (!promo || !promo.coupon.valid) throw new Error('Ce code promo n\'est pas valable');
  if (promo.expires_at && promo.expires_at * 1000 < Date.now()) throw new Error('Ce code promo a expiré');
  if (promo.max_redemptions && promo.times_redeemed >= promo.max_redemptions) throw new Error('Ce code promo a atteint sa limite d\'utilisation');

  const priceId = priceForPlan(plan);
  if (!priceId) throw new Error('Pass indisponible');
  const price = await stripe.prices.retrieve(priceId);
  const productId = typeof price.product === 'string' ? price.product : price.product.id;
  const appliesTo = promo.coupon.applies_to?.products;
  if (appliesTo && appliesTo.length > 0 && !appliesTo.includes(productId)) {
    throw new Error('Ce code promo ne s\'applique pas à ce pass');
  }
  const regular = price.unit_amount ?? 0;
  const minimum = promo.restrictions?.minimum_amount;
  if (minimum && regular < minimum) throw new Error('Ce code promo ne s\'applique pas à ce pass');

  const coupon = promo.coupon;
  let discount = 0;
  let label = '';
  if (coupon.percent_off) {
    discount = Math.round((regular * coupon.percent_off) / 100);
    label = `-${String(coupon.percent_off).replace('.', ',')} % ${durationLabel(coupon)}`;
  } else if (coupon.amount_off) {
    discount = Math.min(regular, coupon.amount_off);
    label = `-${euros(coupon.amount_off)} ${durationLabel(coupon)}`;
  }
  return {
    promotionCodeId: promo.id,
    code: promo.code,
    label,
    firstAmount: Math.max(0, regular - discount) / 100,
    regularAmount: regular / 100,
  };
}
