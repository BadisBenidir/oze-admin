// Abonnements Club B2B (Pass Drops / Pass Revendeur), voir 0167.
//
// Appelé par index.ts pour :
//   - checkout.session.completed en mode "subscription" avec
//     metadata.type = 'b2b_subscription' (session ouverte par b2b-signup ou
//     par b2b-subscription pour un réabonnement) : active le revendeur
//     abonné déjà créé (metadata.reseller_id) et enregistre l'abonnement ;
//   - customer.subscription.updated / customer.subscription.deleted : tient à
//     jour pass, échéance et résiliation, et coupe l'accès à la fin.
//
// Événements à cocher dans le dashboard Stripe (même endpoint que le reste) :
//   checkout.session.completed, customer.subscription.updated,
//   customer.subscription.deleted
//
// Secrets Supabase utilisés pour reconnaître le pass d'un abonnement :
//   STRIPE_PRICE_DROPS, STRIPE_PRICE_REVENDEUR (ids de prix Stripe "price_...")

import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@17.7.0?target=deno';

const LOG_PREFIX = '[b2b-stripe-webhook:subscription]';

type Plan = 'drops' | 'revendeur';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** Pass correspondant au prix de l'abonnement, ou null si prix inconnu. */
const planFromSubscription = (subscription: Stripe.Subscription): Plan | null => {
  const priceId = subscription.items.data[0]?.price?.id;
  if (!priceId) return null;
  if (priceId === Deno.env.get('STRIPE_PRICE_REVENDEUR')) return 'revendeur';
  if (priceId === Deno.env.get('STRIPE_PRICE_DROPS')) return 'drops';
  return null;
};

/** Fin de la période en cours (champ déplacé sur les items dans les versions d'API récentes). */
const periodEnd = (subscription: Stripe.Subscription): string | null => {
  const raw =
    (subscription as unknown as { current_period_end?: number }).current_period_end ??
    (subscription.items.data[0] as unknown as { current_period_end?: number } | undefined)?.current_period_end;
  return raw ? new Date(raw * 1000).toISOString() : null;
};

/** Abonnement Stripe qui donne encore accès (past_due : Stripe retente le prélèvement). */
const grantsAccess = (status: string) => status === 'active' || status === 'trialing' || status === 'past_due';

const subscriptionColumns = (subscription: Stripe.Subscription, fallbackPlan: Plan | null) => ({
  subscription_plan: planFromSubscription(subscription) ?? fallbackPlan,
  subscription_status: subscription.status,
  subscription_current_period_end: periodEnd(subscription),
  subscription_cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
});

/**
 * Paiement d'un pass réussi (inscription ou réabonnement) : active le
 * revendeur abonné. Idempotent : un nouvel envoi du même événement ne change rien.
 */
export async function handleSubscriptionCheckout(
  session: Stripe.Checkout.Session,
  stripe: Stripe,
  supabaseUrl: string,
  serviceRoleKey: string,
): Promise<Response> {
  const metadata = session.metadata || {};
  const resellerId = metadata.reseller_id;
  const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
  const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;

  if (metadata.type !== 'b2b_subscription' || !resellerId || !subscriptionId) {
    // Abonnement Stripe sans rapport avec le Club B2B (ou créé à la main) : ignoré.
    console.log(`${LOG_PREFIX} Session ${session.id} en mode abonnement hors Club B2B — ignorée`);
    return json({ received: true, skipped: 'not_b2b_subscription' });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: reseller, error } = await admin
    .from('resellers')
    .select('id, account_type, stripe_subscription_id')
    .eq('id', resellerId)
    .maybeSingle();

  if (error) return json({ error: error.message }, 500);
  if (!reseller || reseller.account_type !== 'subscriber') {
    console.error(`${LOG_PREFIX} Revendeur abonné ${resellerId} introuvable (session ${session.id}) — paiement à rattacher à la main`);
    return json({ received: true, skipped: 'unknown_reseller' });
  }
  if (reseller.stripe_subscription_id === subscriptionId) {
    return json({ received: true, already_processed: true });
  }

  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const plan = metadata.plan === 'drops' || metadata.plan === 'revendeur' ? metadata.plan : null;

  // Réabonnement : même revendeur, donc statut juridique, préférences,
  // commandes et solde sont conservés — seul l'abonnement est remplacé.
  const { error: updateError } = await admin
    .from('resellers')
    .update({
      status: 'active',
      stripe_customer_id: customerId ?? null,
      stripe_subscription_id: subscriptionId,
      ...subscriptionColumns(subscription, plan),
    })
    .eq('id', resellerId);

  if (updateError) {
    console.error(`${LOG_PREFIX} Activation du revendeur ${resellerId}: ${updateError.message}`);
    return json({ error: updateError.message }, 500);
  }

  console.log(`${LOG_PREFIX} Abonné ${resellerId} activé (${plan}, abonnement ${subscriptionId})`);
  return json({ received: true, reseller_id: resellerId });
}

/** Mise à jour / fin d'abonnement : synchronise le revendeur abonné. */
export async function handleSubscriptionChange(
  subscription: Stripe.Subscription,
  deleted: boolean,
  supabaseUrl: string,
  serviceRoleKey: string,
): Promise<Response> {
  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: reseller, error } = await admin
    .from('resellers')
    .select('id, status, subscription_plan, subscription_status')
    .eq('stripe_subscription_id', subscription.id)
    .maybeSingle();

  if (error) return json({ error: error.message }, 500);
  // Abonnement pas (ou plus) rattaché — ex. ancien abonnement remplacé par un
  // réabonnement : checkout.session.completed fait foi.
  if (!reseller) return json({ received: true, skipped: 'unknown_subscription' });

  const update: Record<string, unknown> = subscriptionColumns(subscription, reseller.subscription_plan as Plan | null);

  if (deleted || !grantsAccess(subscription.status)) {
    // Fin de l'abonnement (résiliation arrivée à échéance, impayé définitif) : accès coupé.
    update.status = 'suspended';
  } else if (reseller.status === 'suspended' && reseller.subscription_status && !grantsAccess(reseller.subscription_status)) {
    // Réactivé après une coupure liée à l'abonnement (jamais une suspension manuelle de l'admin).
    update.status = 'active';
  }

  const { error: updateError } = await admin.from('resellers').update(update).eq('id', reseller.id);
  if (updateError) {
    console.error(`${LOG_PREFIX} Mise à jour abonnement ${subscription.id}: ${updateError.message}`);
    return json({ error: updateError.message }, 500);
  }

  console.log(`${LOG_PREFIX} Abonnement ${subscription.id} → ${subscription.status}${deleted ? ' (terminé)' : ''}, pass ${update.subscription_plan}`);
  return json({ received: true });
}
