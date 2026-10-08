// Edge Function : b2b-signup
//
// Inscription publique à un pass Club B2B depuis /inscription (visiteur non
// connecté, appel avec la clé anon). Voir 0167 / 0175.
//
// AUCUN compte n'est créé avant le paiement :
//   (défaut) inscription : refuse un email déjà utilisé (un abonné déjà
//      inscrit mais résilié est invité à se connecter pour se réabonner),
//      enregistre l'inscription EN ATTENTE (b2b_pending_signups : infos +
//      mot de passe haché bcrypt), crée le client Stripe et ouvre la session
//      de paiement.
//   action "status" (+ session_id) : page de remerciement. Compte déjà créé
//      → ready ; sinon, si Stripe confirme le paiement, le crée tout de suite
//      (sans attendre le webhook, qui le crée aussi — voir _shared/pendingSignup.ts).
//   action "resume" (+ signup_id) : lien de l'email de relance — nouvelle
//      session de paiement pour une inscription jamais payée.
//
// Secrets : STRIPE_SECRET_KEY, STRIPE_PRICE_DROPS, STRIPE_PRICE_REVENDEUR
// Déploiement : `supabase functions deploy b2b-signup`

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@17.7.0?target=deno';
import bcrypt from 'npm:bcryptjs@2.4.3';
import { createSubscriptionCheckout, isSubscriptionPlan, siteOrigin, type SubscriptionPlan } from '../_shared/subscriptionCheckout.ts';
import { countryCode } from '../_shared/stripeBilling.ts';
import { resolvePromotionCode } from '../_shared/subscriptionPromo.ts';
import { finalizePendingSignup } from '../_shared/pendingSignup.ts';
import { handleSubscriptionCheckout } from '../b2b-stripe-webhook/subscriptions.ts';

const PRO_SITE = 'https://pro.ozeparis.com';
/** Au-delà, un lien de reprise de paiement n'est plus accepté (nouvelle inscription requise). */
const RESUME_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const escapeLike = (email: string) => email.replace(/[\\%_]/g, '\\$&');

/** Retour de paiement toujours sur pro.ozeparis.com (hors dev local) : la session de
 * connexion doit s'ouvrir sur le domaine de l'espace pro. */
const checkoutUrls = (req: Request, email: string, plan: SubscriptionPlan) => {
  const origin = siteOrigin(req);
  const proOrigin = origin.startsWith('http://localhost') ? origin : PRO_SITE;
  return {
    successUrl: `${proOrigin}/inscription/merci?email=${encodeURIComponent(email)}&session_id={CHECKOUT_SESSION_ID}`,
    // Paiement abandonné : retour au formulaire (brouillon conservé), aucun compte créé.
    cancelUrl: `${origin}/inscription?pass=${plan}&paiement=annule`,
  };
};

/** Email déjà rattaché à un compte ? Réponse adaptée (abonné résilié → connexion). */
async function emailTaken(admin: SupabaseClient, email: string): Promise<Response | null> {
  const { data: existingProfile } = await admin.from('profiles').select('id').ilike('email', escapeLike(email)).maybeSingle();
  if (!existingProfile) return null;
  const { data: contact } = await admin
    .from('reseller_contacts')
    .select('resellers!inner(account_type, status)')
    .eq('profile_id', existingProfile.id)
    .maybeSingle();
  const reseller = contact && (Array.isArray(contact.resellers) ? contact.resellers[0] : contact.resellers);
  if (reseller?.account_type === 'subscriber' && (reseller.status === 'pending' || reseller.status === 'suspended')) {
    return reply({
      code: 'existing_subscriber',
      error: 'Vous avez déjà un compte avec cet email. Connectez-vous pour reprendre votre abonnement.',
    }, 409);
  }
  return reply({ code: 'email_taken', error: 'Cet email est déjà utilisé. Merci d\'en choisir un autre.' }, 409);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (!stripeSecretKey) return reply({ error: 'Configuration serveur manquante' }, 500);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return reply({ error: 'Requête invalide' }, 400);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-06-20' });

  // ── Page de remerciement : le compte existe-t-il (paiement confirmé) ? ──
  if (body.action === 'status') {
    const sessionId = text(body.session_id, 200);
    if (!sessionId.startsWith('cs_')) return reply({ error: 'Session inconnue' }, 400);
    const { data: signup } = await admin
      .from('b2b_pending_signups')
      .select('id, status')
      .eq('stripe_session_id', sessionId)
      .maybeSingle();
    if (!signup) return reply({ ready: false, paid: false });
    // Compte déjà créé : on s'assure seulement qu'il est activé (webhook en retard ou en échec).
    if (signup.status === 'completed') {
      const { data: done } = await admin.from('b2b_pending_signups').select('reseller_id').eq('id', signup.id).maybeSingle();
      const { data: reseller } = done?.reseller_id
        ? await admin.from('resellers').select('status').eq('id', done.reseller_id).maybeSingle()
        : { data: null };
      if (reseller?.status === 'pending') {
        try {
          const paidSession = await stripe.checkout.sessions.retrieve(sessionId);
          if (paidSession.status === 'complete') await handleSubscriptionCheckout(paidSession, stripe, supabaseUrl, serviceRoleKey);
        } catch (err) {
          console.error('[b2b-signup] status → activation :', err instanceof Error ? err.message : err);
        }
      }
      return reply({ ready: true, paid: true });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const paid = session.status === 'complete' && (session.payment_status === 'paid' || session.payment_status === 'no_payment_required');
    if (!paid) return reply({ ready: false, paid: false });
    try {
      const result = await finalizePendingSignup(admin, signup.id);
      // Activation de l'abonnement (même traitement que le webhook, idempotent :
      // ne fait rien si l'abonnement est déjà enregistré). Évite qu'un compte
      // créé ici reste « en attente » si le webhook est en retard ou a échoué.
      if (result.status === 'completed') {
        const { data: reseller } = await admin.from('resellers').select('status').eq('id', result.resellerId).maybeSingle();
        if (reseller?.status === 'pending') {
          await handleSubscriptionCheckout(session, stripe, supabaseUrl, serviceRoleKey);
        }
      }
      return reply({ ready: result.status === 'completed', paid: true, step: result.status });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[b2b-signup] status → création du compte :', message);
      // Étape en échec renvoyée (sans donnée sensible) pour le diagnostic.
      return reply({ ready: false, paid: true, step: 'error', detail: message });
    }
  }

  // ── Code promo saisi sur la page d'inscription : vérification + aperçu du prix ──
  if (body.action === 'promo') {
    if (!isSubscriptionPlan(body.plan)) return reply({ error: 'Pass invalide' }, 400);
    try {
      const preview = await resolvePromotionCode(stripe, text(body.code, 60), body.plan);
      return reply(preview);
    } catch (err) {
      return reply({ code: 'invalid_promo', error: err instanceof Error ? err.message : 'Code promo invalide' }, 400);
    }
  }

  // ── Lien de l'email de relance : nouvelle session pour une inscription non payée ──
  if (body.action === 'resume') {
    const signupId = text(body.signup_id, 60);
    if (!/^[0-9a-f-]{36}$/i.test(signupId)) return reply({ error: 'Lien invalide' }, 400);
    const { data: signup } = await admin
      .from('b2b_pending_signups')
      .select('id, email, plan, status, stripe_customer_id, created_at')
      .eq('id', signupId)
      .maybeSingle();
    if (!signup) return reply({ code: 'expired', error: 'Ce lien n\'est plus valable. Recommencez votre inscription.' }, 404);
    if (signup.status !== 'pending') {
      return reply({ code: 'already_paid', error: 'Cette inscription est déjà réglée : connectez-vous à votre espace.' }, 409);
    }
    if (Date.now() - new Date(signup.created_at).getTime() > RESUME_MAX_AGE_MS) {
      return reply({ code: 'expired', error: 'Ce lien n\'est plus valable. Recommencez votre inscription.' }, 410);
    }
    const taken = await emailTaken(admin, signup.email);
    if (taken) return taken;

    const plan = signup.plan as SubscriptionPlan;
    const { url, sessionId } = await createSubscriptionCheckout(stripe, {
      plan,
      signupId: signup.id,
      email: signup.email,
      customerId: signup.stripe_customer_id,
      ...checkoutUrls(req, signup.email, plan),
    });
    await admin.from('b2b_pending_signups').update({ stripe_session_id: sessionId }).eq('id', signup.id);
    return reply({ url });
  }

  // ── Inscription ──
  const plan = body.plan;
  const input = {
    first_name: text(body.first_name, 100),
    last_name: text(body.last_name, 100),
    email: text(body.email, 254).toLowerCase(),
    phone: text(body.phone, 30),
    billing_address: text(body.billing_address, 300),
    billing_postal_code: text(body.billing_postal_code, 20),
    billing_city: text(body.billing_city, 100),
    billing_country: text(body.billing_country, 60) || 'France',
  };
  const password = typeof body.password === 'string' ? body.password : '';

  if (!isSubscriptionPlan(plan)) return reply({ error: 'Pass inconnu' }, 400);
  if (!input.first_name || !input.last_name) return reply({ error: 'Prénom et nom requis' }, 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.email)) return reply({ error: 'Email invalide' }, 400);
  if (input.phone.replace(/\D/g, '').length < 6) return reply({ error: 'Téléphone invalide' }, 400);
  if (!input.billing_address || !input.billing_postal_code || !input.billing_city) {
    return reply({ error: 'Adresse de facturation incomplète' }, 400);
  }
  if (password.length < 8) return reply({ error: 'Le mot de passe doit contenir au moins 8 caractères' }, 400);
  if (password.length > 72) return reply({ error: 'Le mot de passe doit contenir au plus 72 caractères' }, 400);
  if (body.terms_accepted !== true) return reply({ error: 'Les conditions générales de vente doivent être acceptées' }, 400);
  const cgvVersion = text(body.cgv_version, 20) || 'inconnue';

  const taken = await emailTaken(admin, input.email);
  if (taken) return taken;

  // Code promo facultatif : revalidé ici (jamais d'id accepté tel quel du client).
  let promotionCodeId: string | undefined;
  const promoCode = text(body.promo_code, 60);
  if (promoCode) {
    try {
      promotionCodeId = (await resolvePromotionCode(stripe, promoCode, plan)).promotionCodeId;
    } catch (err) {
      return reply({ code: 'invalid_promo', error: err instanceof Error ? err.message : 'Code promo invalide' }, 400);
    }
  }

  try {
    // Inscription précédente non payée avec le même email : son client Stripe
    // est réutilisé (pas de doublon de clients), l'ancienne inscription remplacée.
    const { data: previous } = await admin
      .from('b2b_pending_signups')
      .select('id, stripe_customer_id')
      .ilike('email', escapeLike(input.email))
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: signup, error: signupError } = await admin
      .from('b2b_pending_signups')
      .insert({
        ...input,
        plan,
        password_hash: bcrypt.hashSync(password, 10),
        cgv_version: cgvVersion,
        stripe_customer_id: previous?.stripe_customer_id ?? null,
      })
      .select('id')
      .single();
    if (signupError || !signup) throw new Error(`inscription : ${signupError?.message}`);
    if (previous) await admin.from('b2b_pending_signups').delete().eq('id', previous.id);

    // Client Stripe avec l'identité et l'adresse de facturation saisies (la
    // facture du premier mois les porte), et la preuve d'acceptation des CGV.
    const customerFields = {
      email: input.email,
      name: `${input.first_name} ${input.last_name}`,
      phone: input.phone,
      address: {
        line1: input.billing_address,
        postal_code: input.billing_postal_code,
        city: input.billing_city,
        country: countryCode(input.billing_country),
      },
      preferred_locales: ['fr'],
      metadata: { signup_id: signup.id, cgv_version: cgvVersion, cgv_accepted_at: new Date().toISOString() },
    };
    const customer = previous?.stripe_customer_id
      ? await stripe.customers.update(previous.stripe_customer_id, customerFields)
      : await stripe.customers.create(customerFields);

    const { url, sessionId } = await createSubscriptionCheckout(stripe, {
      plan,
      signupId: signup.id,
      email: input.email,
      customerId: customer.id,
      promotionCodeId,
      ...checkoutUrls(req, input.email, plan),
    });
    await admin
      .from('b2b_pending_signups')
      .update({ stripe_customer_id: customer.id, stripe_session_id: sessionId })
      .eq('id', signup.id);

    return reply({ url });
  } catch (err) {
    console.error('[b2b-signup] Échec :', err instanceof Error ? err.message : err);
    return reply({ error: 'L\'inscription a échoué, réessayez dans un instant.' }, 500);
  }
});
