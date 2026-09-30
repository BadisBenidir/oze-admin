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
import { sendSubscriptionWelcomeEmail } from './welcomeEmail.ts';
import { sendAbandonedSignupEmail, sendPaymentFailedEmail, sendSubscriptionInvoiceEmail } from './subscriptionEmails.ts';
import { syncStripeBillingIdentity } from '../_shared/stripeBilling.ts';
import { finalizePendingSignup } from '../_shared/pendingSignup.ts';

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
  let resellerId = metadata.reseller_id;
  const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
  const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;

  if (metadata.type !== 'b2b_subscription' || (!resellerId && !metadata.signup_id) || !subscriptionId) {
    // Abonnement Stripe sans rapport avec le Club B2B (ou créé à la main) : ignoré.
    console.log(`${LOG_PREFIX} Session ${session.id} en mode abonnement hors Club B2B — ignorée`);
    return json({ received: true, skipped: 'not_b2b_subscription' });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);

  // Nouvelle inscription (0175) : le compte n'existe pas encore, il est créé
  // maintenant que le paiement est confirmé (ou l'a déjà été par la page de
  // remerciement). Création en cours ailleurs → 500 : Stripe renverra l'événement.
  if (!resellerId && metadata.signup_id) {
    const created = await finalizePendingSignup(admin, metadata.signup_id);
    if (created.status === 'busy') return json({ error: 'Création du compte en cours, réessai' }, 500);
    if (created.status === 'not_found') {
      console.error(`${LOG_PREFIX} Inscription ${metadata.signup_id} introuvable (session ${session.id}) — paiement à rattacher à la main`);
      return json({ received: true, skipped: 'unknown_signup' });
    }
    resellerId = created.resellerId;
    // L'abonnement porte désormais l'id du revendeur (recherches de b2b-subscription).
    try {
      await stripe.subscriptions.update(subscriptionId, { metadata: { ...metadata, reseller_id: resellerId } });
    } catch (err) {
      console.warn(`${LOG_PREFIX} Métadonnées de l'abonnement ${subscriptionId} :`, err instanceof Error ? err.message : err);
    }
  }
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

  // Email de bienvenue + facture : jamais bloquant pour l'activation (le
  // compte est déjà actif, un échec d'envoi est seulement logué).
  try {
    const { data: contact } = await admin
      .from('reseller_contacts')
      .select('profile_id, profiles!inner(email, first_name)')
      .eq('reseller_id', resellerId)
      .limit(1)
      .maybeSingle();
    const person = contact && (Array.isArray(contact.profiles) ? contact.profiles[0] : contact.profiles);

    // Réabonnement d'un abonné qui a déjà déclaré son statut juridique : ses
    // prochaines factures portent tout de suite sa dénomination, SIRET et TVA.
    if (contact?.profile_id && customerId) {
      try {
        await syncStripeBillingIdentity(stripe, admin, contact.profile_id, customerId);
      } catch (err) {
        console.warn(`${LOG_PREFIX} Identité de facturation non synchronisée (${resellerId}) :`, err instanceof Error ? err.message : err);
      }
    }
    const to = person?.email || session.customer_details?.email || session.customer_email;
    if (to) {
      const invoiceId =
        (typeof session.invoice === 'string' ? session.invoice : session.invoice?.id) ??
        (typeof subscription.latest_invoice === 'string' ? subscription.latest_invoice : subscription.latest_invoice?.id) ??
        null;
      await sendSubscriptionWelcomeEmail({
        stripe,
        to,
        firstName: person?.first_name ?? null,
        plan: subscriptionColumns(subscription, plan).subscription_plan,
        invoiceId,
        // Un ancien abonnement était rattaché : c'est un réabonnement.
        returning: Boolean(reseller.stripe_subscription_id),
      });
    } else {
      console.warn(`${LOG_PREFIX} Aucun email pour l'abonné ${resellerId} — bienvenue non envoyé`);
    }
  } catch (err) {
    console.error(`${LOG_PREFIX} Email de bienvenue (${resellerId}) :`, err instanceof Error ? err.message : err);
  }

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

  // Passage au Pass Drops programmé (b2b-subscription "downgrade") désormais
  // appliqué : on efface le pass en attente. Requête séparée et tolérante
  // (colonne 0174) : n'empêche jamais la synchronisation ci-dessus.
  if (update.subscription_plan) {
    const { error: pendingError } = await admin
      .from('resellers')
      .update({ subscription_pending_plan: null })
      .eq('id', reseller.id)
      .eq('subscription_pending_plan', update.subscription_plan);
    if (pendingError) console.warn(`${LOG_PREFIX} subscription_pending_plan : ${pendingError.message}`);
  }

  console.log(`${LOG_PREFIX} Abonnement ${subscription.id} → ${subscription.status}${deleted ? ' (terminé)' : ''}, pass ${update.subscription_plan}`);
  return json({ received: true });
}

const PLAN_LABEL: Record<string, string> = { drops: 'Pass Drops', revendeur: 'Pass Revendeur' };
/** Reprise du paiement d'une inscription non finalisée (lien de l'email de relance). */
const RESUME_URL = 'https://b2b.ozeparis.com/inscription/reprendre';

/** Email + prénom du contact d'un revendeur abonné (un seul contact par abonné). */
const subscriberContact = async (admin: ReturnType<typeof createClient>, resellerId: string) => {
  const { data } = await admin
    .from('reseller_contacts')
    .select('profiles!inner(email, first_name)')
    .eq('reseller_id', resellerId)
    .limit(1)
    .maybeSingle();
  const person = data && (Array.isArray(data.profiles) ? data.profiles[0] : data.profiles);
  return person as { email: string | null; first_name: string | null } | null;
};

/**
 * Session d'inscription expirée sans paiement (checkout.session.expired) :
 * relance par email tant que le compte est toujours en attente. Les
 * sessions d'abonnement expirent au bout de quelques heures (voir
 * createSubscriptionCheckout), la relance part donc le jour même.
 */
export async function handleAbandonedSubscriptionCheckout(
  session: Stripe.Checkout.Session,
  supabaseUrl: string,
  serviceRoleKey: string,
): Promise<Response> {
  const signupId = session.metadata?.signup_id;
  if (!signupId) return json({ received: true, skipped: 'no_signup' });

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: signup } = await admin
    .from('b2b_pending_signups')
    .select('id, email, first_name, plan, status, stripe_session_id')
    .eq('id', signupId)
    .maybeSingle();
  // Relance uniquement une inscription toujours non payée, et seulement pour sa
  // dernière session (une reprise de paiement en a ouvert une nouvelle).
  if (!signup || signup.status !== 'pending' || signup.stripe_session_id !== session.id) {
    return json({ received: true, skipped: 'not_pending' });
  }

  try {
    await sendAbandonedSignupEmail(
      signup.email,
      signup.first_name ?? null,
      PLAN_LABEL[signup.plan] || 'Club B2B',
      `${RESUME_URL}?id=${signup.id}`,
    );
  } catch (err) {
    console.error(`${LOG_PREFIX} Relance inscription (${signupId}) :`, err instanceof Error ? err.message : err);
  }
  return json({ received: true });
}

/**
 * Prélèvement d'une échéance refusé (invoice.payment_failed) : email au
 * premier échec et au dernier essai (Stripe retente entre les deux).
 */
export async function handleSubscriptionPaymentFailed(
  invoice: Stripe.Invoice,
  supabaseUrl: string,
  serviceRoleKey: string,
): Promise<Response> {
  const subscriptionId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id;
  if (!subscriptionId) return json({ received: true, skipped: 'not_subscription' });

  const finalAttempt = !invoice.next_payment_attempt;
  if ((invoice.attempt_count ?? 0) > 1 && !finalAttempt) return json({ received: true, skipped: 'intermediate_attempt' });

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: reseller } = await admin
    .from('resellers')
    .select('id, account_type, subscription_plan')
    .eq('stripe_subscription_id', subscriptionId)
    .maybeSingle();
  if (!reseller || reseller.account_type !== 'subscriber') return json({ received: true, skipped: 'unknown_subscription' });

  try {
    const person = await subscriberContact(admin, reseller.id);
    const to = person?.email || invoice.customer_email;
    if (to) {
      await sendPaymentFailedEmail({
        to,
        firstName: person?.first_name ?? null,
        planName: PLAN_LABEL[reseller.subscription_plan || ''] || 'abonnement Club B2B',
        amount: ((invoice.amount_due ?? 0) / 100).toLocaleString('fr-FR', { style: 'currency', currency: (invoice.currency || 'eur').toUpperCase() }),
        payUrl: invoice.hosted_invoice_url ?? null,
        finalAttempt,
      });
    }
  } catch (err) {
    console.error(`${LOG_PREFIX} Email d'échec de paiement (${reseller.id}) :`, err instanceof Error ? err.message : err);
  }
  return json({ received: true });
}

/**
 * Échéance payée (invoice.paid) : facture envoyée par email à l'abonné.
 * La facture de la souscription elle-même (billing_reason
 * 'subscription_create') part déjà avec l'email de bienvenue : seuls les
 * renouvellements ('subscription_cycle') et les changements de pass facturés
 * ('subscription_update', différence au prorata) sont envoyés ici. Une
 * facture à 0 € (aucun montant réglé) n'est pas envoyée.
 */
export async function handleSubscriptionInvoicePaid(
  invoice: Stripe.Invoice,
  supabaseUrl: string,
  serviceRoleKey: string,
): Promise<Response> {
  const reason = invoice.billing_reason;
  if (reason !== 'subscription_cycle' && reason !== 'subscription_update') {
    return json({ received: true, skipped: `billing_reason_${reason}` });
  }
  if (!invoice.amount_paid) return json({ received: true, skipped: 'zero_amount' });
  const subscriptionId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id;
  if (!subscriptionId) return json({ received: true, skipped: 'not_subscription' });

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: reseller } = await admin
    .from('resellers')
    .select('id, account_type, subscription_plan')
    .eq('stripe_subscription_id', subscriptionId)
    .maybeSingle();
  if (!reseller || reseller.account_type !== 'subscriber') return json({ received: true, skipped: 'unknown_subscription' });

  try {
    const person = await subscriberContact(admin, reseller.id);
    const to = person?.email || invoice.customer_email;
    if (to) {
      const line = invoice.lines?.data?.[0];
      const periodStart = line?.period?.start ? new Date(line.period.start * 1000) : null;
      await sendSubscriptionInvoiceEmail({
        to,
        firstName: person?.first_name ?? null,
        planName: PLAN_LABEL[reseller.subscription_plan || ''] || 'abonnement Club B2B',
        invoiceNumber: invoice.number ?? null,
        amount: (invoice.amount_paid / 100).toLocaleString('fr-FR', { style: 'currency', currency: (invoice.currency || 'eur').toUpperCase() }),
        periodLabel: periodStart ? periodStart.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) : null,
        pdfUrl: invoice.invoice_pdf ?? null,
        hostedUrl: invoice.hosted_invoice_url ?? null,
        isPlanChange: reason === 'subscription_update',
      });
    }
  } catch (err) {
    console.error(`${LOG_PREFIX} Email de facture (${reseller.id}) :`, err instanceof Error ? err.message : err);
  }
  return json({ received: true });
}
