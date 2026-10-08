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
    /** Réabonnement : revendeur existant. Inscription : signupId (b2b_pending_signups), le compte n'existe pas encore. */
    resellerId?: string;
    signupId?: string;
    email: string;
    /** Client Stripe existant (réabonnement) : garde son historique et ses cartes. */
    customerId?: string | null;
    successUrl: string;
    cancelUrl: string;
    /** Code promo saisi sur la page d'inscription et déjà validé (subscriptionPromo.ts). */
    promotionCodeId?: string;
  },
): Promise<{ url: string; sessionId: string }> {
  if (!params.resellerId && !params.signupId) throw new Error('resellerId ou signupId requis');
  const price = priceForPlan(params.plan);
  if (!price) throw new Error(`Prix Stripe non configuré pour le pass ${params.plan}`);

  const metadata: Record<string, string> = {
    type: 'b2b_subscription',
    plan: params.plan,
    ...(params.resellerId ? { reseller_id: params.resellerId } : {}),
    ...(params.signupId ? { signup_id: params.signupId } : {}),
  };
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price, quantity: 1 }],
    ...(params.customerId
      ? {
          customer: params.customerId,
          // Requis par tax_id_collection sur un client existant : le nom saisi
          // (dénomination) et le n° de TVA sont enregistrés sur le client.
          customer_update: { name: 'auto', address: 'auto' },
        }
      : { customer_email: params.email }),
    // N° de TVA intracommunautaire facultatif, reporté sur les factures.
    tax_id_collection: { enabled: true },
    // Paiement non finalisé : la session expire au bout de 4 h, ce qui
    // déclenche la relance par email (checkout.session.expired).
    expires_at: Math.floor(Date.now() / 1000) + 4 * 60 * 60,
    client_reference_id: params.resellerId ?? params.signupId,
    metadata,
    subscription_data: { metadata },
    locale: 'fr',
    // Code saisi chez nous : appliqué d'office. Sinon, le champ « code promo »
    // de la page Stripe reste disponible (les deux sont exclusifs chez Stripe).
    ...(params.promotionCodeId
      ? { discounts: [{ promotion_code: params.promotionCodeId }] }
      : { allow_promotion_codes: true }),
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
  });
  if (!session.url) throw new Error('Session Stripe sans URL');
  return { url: session.url, sessionId: session.id };
}
