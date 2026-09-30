// Session Stripe Checkout d'un abonnement Club B2B (Pass Drops / Pass
// Revendeur), partagée par b2b-signup (inscription) et b2b-subscription
// (réabonnement). Le webhook b2b-stripe-webhook active ensuite le revendeur
// désigné par metadata.reseller_id (voir 0167).
//
// Secrets : STRIPE_PRICE_DROPS, STRIPE_PRICE_REVENDEUR (ids "price_...").

import Stripe from 'https://esm.sh/stripe@17.7.0?target=deno';

export type SubscriptionPlan = 'drops' | 'revendeur';

export const isSubscriptionPlan = (value: unknown): value is SubscriptionPlan =>
  value === 'drops' || value === 'revendeur';

export const priceForPlan = (plan: SubscriptionPlan): string | undefined =>
  Deno.env.get(plan === 'revendeur' ? 'STRIPE_PRICE_REVENDEUR' : 'STRIPE_PRICE_DROPS');

const DEFAULT_SITE = 'https://pro.ozeparis.com';

/** Origine du site appelant (prod ou localhost en dev), jamais une origine arbitraire. */
export const siteOrigin = (req: Request): string => {
  const origin = req.headers.get('Origin') || '';
  return /^https:\/\/(pro|b2b)\.ozeparis\.com$|^http:\/\/localhost(:\d+)?$/.test(origin) ? origin : DEFAULT_SITE;
};

export async function createSubscriptionCheckout(
  stripe: Stripe,
  params: {
    plan: SubscriptionPlan;
    resellerId: string;
    email: string;
    /** Client Stripe existant (réabonnement) : garde son historique et ses cartes. */
    customerId?: string | null;
    successUrl: string;
    cancelUrl: string;
  },
): Promise<string> {
  const price = priceForPlan(params.plan);
  if (!price) throw new Error(`Prix Stripe non configuré pour le pass ${params.plan}`);

  const metadata = { type: 'b2b_subscription', reseller_id: params.resellerId, plan: params.plan };
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price, quantity: 1 }],
    ...(params.customerId ? { customer: params.customerId } : { customer_email: params.email }),
    client_reference_id: params.resellerId,
    metadata,
    subscription_data: { metadata },
    locale: 'fr',
    allow_promotion_codes: true,
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
  });
  if (!session.url) throw new Error('Session Stripe sans URL');
  return session.url;
}
