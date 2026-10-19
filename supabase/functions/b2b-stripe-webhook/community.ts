// Abonnements des membres de communautés partenaires (0214), ouverts par
// l'Edge Function community-subscription (metadata.type = 'community_subscription').
//
// Appelé par index.ts pour :
//   - checkout.session.completed : enregistre l'abonnement sur la ligne
//     reseller_contacts du membre (metadata.contact_id) ;
//   - customer.subscription.updated / .deleted : tient à jour statut et échéance.
// N'agit jamais sur un revendeur abonné Club (subscriptions.ts).

import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@17.7.0?target=deno';

const LOG_PREFIX = '[b2b-stripe-webhook:community]';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

export const isCommunitySubscription = (metadata: Stripe.Metadata | null | undefined) =>
  metadata?.type === 'community_subscription';

const periodEnd = (subscription: Stripe.Subscription): string | null => {
  const raw =
    (subscription as unknown as { current_period_end?: number }).current_period_end ??
    (subscription.items.data[0] as unknown as { current_period_end?: number } | undefined)?.current_period_end;
  return raw ? new Date(raw * 1000).toISOString() : null;
};

/** Offre en cours : 'drops' une fois la phase Pass Drops du planning
 * Stripe commencée (metadata.community_plan, posée par community-subscription). */
const planOf = (subscription: Stripe.Subscription) => (subscription.metadata?.community_plan === 'drops' ? 'drops' : 'community');

const subscriptionColumns = (subscription: Stripe.Subscription) => ({
  community_sub_status: subscription.status,
  community_sub_current_period_end: periodEnd(subscription),
  community_sub_price: (subscription.items.data[0]?.price?.unit_amount ?? 0) / 100,
  community_sub_plan: planOf(subscription),
});

/** Paiement de l'abonnement d'un membre réussi. Idempotent. */
export async function handleCommunityCheckout(
  session: Stripe.Checkout.Session,
  stripe: Stripe,
  supabaseUrl: string,
  serviceRoleKey: string,
): Promise<Response> {
  const contactId = session.metadata?.contact_id;
  const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
  const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
  if (!contactId || !subscriptionId) {
    console.error(`${LOG_PREFIX} Session ${session.id} incomplète (contact ${contactId}, abonnement ${subscriptionId})`);
    return json({ received: true, skipped: 'incomplete_session' });
  }

  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { error } = await admin
    .from('reseller_contacts')
    .update({
      ...subscriptionColumns(subscription),
      community_sub_stripe_subscription_id: subscriptionId,
      community_sub_stripe_customer_id: customerId ?? null,
      community_sub_started_at: new Date().toISOString(),
      community_sub_pending_plan: null,
    })
    .eq('id', contactId);
  if (error) {
    console.error(`${LOG_PREFIX} Enregistrement abonnement membre ${contactId}: ${error.message}`);
    return json({ error: error.message }, 500);
  }
  console.log(`${LOG_PREFIX} Abonnement ${subscriptionId} enregistré pour le membre ${contactId}`);
  return json({ received: true, contact_id: contactId });
}

/** Changement de statut / échéance / fin d'un abonnement membre. */
export async function handleCommunitySubscriptionChange(
  subscription: Stripe.Subscription,
  deleted: boolean,
  supabaseUrl: string,
  serviceRoleKey: string,
): Promise<Response> {
  const admin = createClient(supabaseUrl, serviceRoleKey);
  const columns: Record<string, unknown> = subscriptionColumns(subscription);
  if (deleted) columns.community_sub_status = 'canceled';
  // Passage au Pass Drops effectif (ou abonnement terminé) : plus rien de programmé.
  if (deleted || columns.community_sub_plan === 'drops') columns.community_sub_pending_plan = null;
  const { data, error } = await admin
    .from('reseller_contacts')
    .update(columns)
    .eq('community_sub_stripe_subscription_id', subscription.id)
    .select('id');
  if (error) {
    console.error(`${LOG_PREFIX} Mise à jour abonnement ${subscription.id}: ${error.message}`);
    return json({ error: error.message }, 500);
  }
  if (!data?.length) return json({ received: true, skipped: 'unknown_subscription' });
  return json({ received: true });
}

/**
 * Facture payée d'un abonnement membre (invoice.paid) : enregistrée dans
 * community_subscription_payments (0217) pour le CA par partenaire. Ignore
 * tout autre abonnement. Idempotent (une ligne par facture).
 */
export async function recordCommunityInvoice(
  invoice: Stripe.Invoice,
  stripe: Stripe,
  supabaseUrl: string,
  serviceRoleKey: string,
): Promise<boolean> {
  const subscriptionId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id;
  if (!subscriptionId || invoice.status !== 'paid' || !invoice.amount_paid) return false;
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  if (!isCommunitySubscription(subscription.metadata)) return false;

  const metadata = subscription.metadata || {};
  const paidAt = invoice.status_transitions?.paid_at ?? invoice.created;
  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { error } = await admin.from('community_subscription_payments').upsert(
    {
      stripe_invoice_id: invoice.id,
      stripe_subscription_id: subscriptionId,
      stripe_customer_id: typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id ?? null,
      reseller_id: metadata.reseller_id || null,
      contact_id: metadata.contact_id || null,
      profile_id: metadata.profile_id || null,
      amount: invoice.amount_paid / 100,
      currency: invoice.currency || 'eur',
      plan: planOf(subscription),
      billing_reason: invoice.billing_reason ?? null,
      invoice_number: invoice.number ?? null,
      paid_at: new Date(paidAt * 1000).toISOString(),
    },
    { onConflict: 'stripe_invoice_id' },
  );
  if (error) throw new Error(`paiement membre ${invoice.id} : ${error.message}`);
  console.log(`${LOG_PREFIX} Facture ${invoice.id} (${invoice.amount_paid / 100} €) enregistrée pour le membre ${metadata.contact_id}`);
  return true;
}
