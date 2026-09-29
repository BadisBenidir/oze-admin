// Abonnements Club B2B (Pass Drops / Pass Revendeur), voir 0167.
//
// Appelé par index.ts pour :
//   - checkout.session.completed en mode "subscription" (Stripe Payment Link
//     de la landing, client_reference_id = b2b_signup_requests.id) : crée le
//     revendeur abonné, son compte de connexion et envoie l'invitation ;
//   - customer.subscription.updated / customer.subscription.deleted : tient à
//     jour pass, échéance et résiliation, et coupe l'accès à la fin.
//
// Événements à cocher dans le dashboard Stripe (même endpoint que le reste) :
//   checkout.session.completed, customer.subscription.updated,
//   customer.subscription.deleted
//
// Secrets Supabase utilisés pour reconnaître le pass d'un abonnement :
//   STRIPE_PRICE_DROPS, STRIPE_PRICE_REVENDEUR (ids de prix Stripe "price_...")

import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@17.7.0?target=deno';

const LOG_PREFIX = '[b2b-stripe-webhook:subscription]';
const INVITE_REDIRECT_TO = 'https://pro.ozeparis.com/accept-invite';

type Plan = 'drops' | 'revendeur';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** Pass correspondant au prix de l'abonnement, ou null si prix inconnu. */
export const planFromSubscription = (subscription: Stripe.Subscription): Plan | null => {
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
const grantsAccess = (status: Stripe.Subscription.Status) =>
  status === 'active' || status === 'trialing' || status === 'past_due';

export const subscriptionColumns = (subscription: Stripe.Subscription, fallbackPlan: Plan | null) => ({
  subscription_plan: planFromSubscription(subscription) ?? fallbackPlan,
  subscription_status: subscription.status,
  subscription_current_period_end: periodEnd(subscription),
  subscription_cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
});

const markNeedsReview = async (admin: SupabaseClient, requestId: string, note: string, extra: Record<string, unknown> = {}) => {
  console.error(`${LOG_PREFIX} Demande ${requestId} à traiter manuellement : ${note}`);
  await admin.from('b2b_signup_requests').update({ status: 'needs_review', admin_notes: note, ...extra }).eq('id', requestId);
};

/**
 * Paiement d'un pass réussi : crée le revendeur abonné et son accès.
 * Idempotent : un nouvel envoi du même événement ne recrée rien.
 */
export async function handleSubscriptionCheckout(
  session: Stripe.Checkout.Session,
  stripe: Stripe,
  supabaseUrl: string,
  serviceRoleKey: string,
): Promise<Response> {
  const admin = createClient(supabaseUrl, serviceRoleKey);
  const requestId = session.client_reference_id;
  const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
  const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;

  if (!requestId || !subscriptionId) {
    // Abonnement souscrit sans passer par /inscription (lien Stripe partagé
    // directement) : rien à rattacher automatiquement, visible dans Stripe.
    console.error(`${LOG_PREFIX} Session ${session.id} sans client_reference_id ou abonnement — aucun compte créé`);
    return json({ received: true, skipped: 'no_signup_request' });
  }

  const { data: request, error: requestError } = await admin
    .from('b2b_signup_requests')
    .select('*')
    .eq('id', requestId)
    .maybeSingle();

  if (requestError) {
    console.error(`${LOG_PREFIX} Lecture de la demande ${requestId} impossible: ${requestError.message}`);
    return json({ error: requestError.message }, 500);
  }
  if (!request) {
    console.error(`${LOG_PREFIX} Demande ${requestId} introuvable (session ${session.id})`);
    return json({ received: true, skipped: 'unknown_signup_request' });
  }
  if (request.status === 'account_created') {
    return json({ received: true, already_processed: true });
  }

  const stripeRefs = { stripe_session_id: session.id, stripe_customer_id: customerId ?? null, stripe_subscription_id: subscriptionId };
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const email = String(request.email).toLowerCase();
  const fullName = `${request.first_name} ${request.last_name}`.trim();

  // Compte existant pour cet email ?
  const { data: users, error: listError } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (listError) {
    console.error(`${LOG_PREFIX} listUsers: ${listError.message}`);
    return json({ error: listError.message }, 500);
  }
  const existingUser = users?.users.find((u) => u.email?.toLowerCase() === email);

  if (existingUser) {
    const { data: existingProfile } = await admin.from('profiles').select('role').eq('id', existingUser.id).maybeSingle();
    const { data: existingContact } = await admin
      .from('reseller_contacts').select('reseller_id').eq('profile_id', existingUser.id).maybeSingle();
    if (existingProfile?.role === 'admin' || existingContact) {
      await markNeedsReview(
        admin,
        requestId,
        existingProfile?.role === 'admin'
          ? 'Email déjà utilisé par un compte administrateur.'
          : 'Email déjà rattaché à un compte revendeur existant : abonnement payé, à rattacher manuellement.',
        stripeRefs,
      );
      return json({ received: true, needs_review: true });
    }
  }

  // 1. Revendeur abonné, actif immédiatement.
  const { data: reseller, error: resellerError } = await admin
    .from('resellers')
    .insert({
      company_name: fullName,
      status: 'active',
      account_type: 'subscriber',
      contact_email: email,
      contact_phone: request.phone,
      address: request.billing_address,
      postal_code: request.billing_postal_code,
      city: request.billing_city,
      country: request.billing_country,
      stripe_customer_id: customerId ?? null,
      stripe_subscription_id: subscriptionId,
      ...subscriptionColumns(subscription, request.plan as Plan),
    })
    .select('id')
    .single();

  if (resellerError || !reseller) {
    // Doublon d'événement arrivé en parallèle : l'abonnement est déjà rattaché.
    if (resellerError?.code === '23505') return json({ received: true, already_processed: true });
    console.error(`${LOG_PREFIX} Création du revendeur (demande ${requestId}): ${resellerError?.message}`);
    return json({ error: resellerError?.message }, 500);
  }

  // 2. Compte de connexion : compte client existant du site public converti
  //    (il garde son mot de passe), sinon invitation par email.
  let userId: string;
  let activatedAt: string | null = null;
  let lastInvitedAt: string | null = null;
  if (existingUser) {
    userId = existingUser.id;
    activatedAt = new Date().toISOString();
  } else {
    const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { first_name: request.first_name, last_name: request.last_name },
      redirectTo: INVITE_REDIRECT_TO,
    });
    if (inviteError || !invited?.user) {
      await admin.from('resellers').delete().eq('id', reseller.id);
      console.error(`${LOG_PREFIX} Invitation ${email}: ${inviteError?.message}`);
      return json({ error: inviteError?.message ?? 'invitation impossible' }, 500);
    }
    userId = invited.user.id;
    lastInvitedAt = new Date().toISOString();
  }

  const { error: profileError } = await admin.from('profiles').upsert({
    id: userId,
    email,
    first_name: request.first_name,
    last_name: request.last_name,
    phone: request.phone,
    role: 'reseller',
    activated_at: activatedAt,
    last_invited_at: lastInvitedAt,
  });
  if (profileError) {
    console.error(`${LOG_PREFIX} Profil ${email}: ${profileError.message}`);
    return json({ error: profileError.message }, 500);
  }

  // Unique compte de l'abonné, jamais "principal" : pas de gestion d'équipe.
  const { error: contactError } = await admin
    .from('reseller_contacts')
    .insert({ reseller_id: reseller.id, profile_id: userId, is_primary: false });
  if (contactError) {
    console.error(`${LOG_PREFIX} Contact ${email}: ${contactError.message}`);
    return json({ error: contactError.message }, 500);
  }

  await admin
    .from('b2b_signup_requests')
    .update({ status: 'account_created', reseller_id: reseller.id, ...stripeRefs })
    .eq('id', requestId);

  console.log(`${LOG_PREFIX} Abonné créé : ${email} (${request.plan}), revendeur ${reseller.id}`);
  return json({ received: true, reseller_id: reseller.id });
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
  // Abonnement pas (encore) rattaché : checkout.session.completed s'en charge.
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
