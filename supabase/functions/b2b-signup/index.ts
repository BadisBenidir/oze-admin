// Edge Function : b2b-signup
//
// Inscription publique à un pass Club B2B depuis /inscription (visiteur non
// connecté, appel avec la clé anon). Voir 0167.
//
//   1. Refuse tout email déjà présent dans la base de comptes : revendeur,
//      admin, ou client du site principal (même projet Supabase, un email =
//      un seul compte). Cas particulier : un abonné déjà inscrit mais non
//      payé, ou résilié, est invité à se connecter pour finaliser / se
//      réabonner (jamais de réécriture de son mot de passe ici).
//   2. Crée le compte de connexion avec le mot de passe choisi (aucun email
//      d'invitation), le profil, un revendeur « abonné » en 'pending' et son
//      unique contact (is_primary = false).
//   3. Ouvre la session Stripe Checkout ; le webhook passe le revendeur en
//      'active' une fois le paiement confirmé.
// Toute erreur après la création du compte annule ce qui a été créé.
//
// Secrets : STRIPE_SECRET_KEY, STRIPE_PRICE_DROPS, STRIPE_PRICE_REVENDEUR
// Déploiement : `supabase functions deploy b2b-signup`

import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@17.7.0?target=deno';
import { createSubscriptionCheckout, isSubscriptionPlan, siteOrigin } from '../_shared/subscriptionCheckout.ts';
import { countryCode } from '../_shared/stripeBilling.ts';

const PRO_SITE = 'https://pro.ozeparis.com';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

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
  if (body.terms_accepted !== true) return reply({ error: 'Les conditions générales de vente doivent être acceptées' }, 400);

  const admin = createClient(supabaseUrl, serviceRoleKey);

  // 1. Email déjà utilisé ? (profiles.email reflète auth.users pour tous les
  //    comptes des deux sites ; createUser ci-dessous refuse de toute façon un doublon.)
  const { data: existingProfile } = await admin
    .from('profiles')
    .select('id')
    // ilike = comparaison insensible à la casse ; % et _ échappés (le _ est courant dans un email).
    .ilike('email', input.email.replace(/[\\%_]/g, '\\$&'))
    .maybeSingle();

  const emailTakenResponse = async (profileId: string | null) => {
    if (profileId) {
      const { data: contact } = await admin
        .from('reseller_contacts')
        .select('resellers!inner(account_type, status)')
        .eq('profile_id', profileId)
        .maybeSingle();
      const reseller = contact && (Array.isArray(contact.resellers) ? contact.resellers[0] : contact.resellers);
      if (reseller?.account_type === 'subscriber' && (reseller.status === 'pending' || reseller.status === 'suspended')) {
        return reply({
          code: 'existing_subscriber',
          error: 'Vous avez déjà un compte avec cet email. Connectez-vous pour finaliser ou reprendre votre abonnement.',
        }, 409);
      }
    }
    return reply({ code: 'email_taken', error: 'Cet email est déjà utilisé. Merci d\'en choisir un autre.' }, 409);
  };

  if (existingProfile) return emailTakenResponse(existingProfile.id);

  // 2. Compte de connexion, profil, revendeur abonné en attente, contact.
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: input.email,
    password,
    email_confirm: true,
    user_metadata: { first_name: input.first_name, last_name: input.last_name },
  });
  if (createError || !created?.user) {
    const msg = createError?.message || '';
    if (/already|exists|registered/i.test(msg)) return emailTakenResponse(null);
    if (/password/i.test(msg)) return reply({ error: `Mot de passe refusé : ${msg}` }, 400);
    console.error('[b2b-signup] createUser:', msg);
    return reply({ error: 'La création du compte a échoué, réessayez.' }, 500);
  }
  const userId = created.user.id;
  let resellerId: string | null = null;

  const rollback = async () => {
    if (resellerId) await admin.from('resellers').delete().eq('id', resellerId);
    await admin.auth.admin.deleteUser(userId);
    await admin.from('profiles').delete().eq('id', userId);
  };

  try {
    const { error: profileError } = await admin.from('profiles').upsert({
      id: userId,
      email: input.email,
      first_name: input.first_name,
      last_name: input.last_name,
      phone: input.phone,
      role: 'reseller',
      activated_at: new Date().toISOString(),
      last_invited_at: null,
    });
    if (profileError) throw new Error(`profil : ${profileError.message}`);

    const { data: reseller, error: resellerError } = await admin
      .from('resellers')
      .insert({
        company_name: `${input.first_name} ${input.last_name}`,
        status: 'pending',
        account_type: 'subscriber',
        subscription_plan: plan,
        contact_email: input.email,
        contact_phone: input.phone,
        address: input.billing_address,
        postal_code: input.billing_postal_code,
        city: input.billing_city,
        country: input.billing_country,
      })
      .select('id')
      .single();
    if (resellerError || !reseller) throw new Error(`revendeur : ${resellerError?.message}`);
    resellerId = reseller.id;

    const { error: contactError } = await admin
      .from('reseller_contacts')
      .insert({ reseller_id: reseller.id, profile_id: userId, is_primary: false });
    if (contactError) throw new Error(`contact : ${contactError.message}`);

    // 3. Paiement.
    const origin = siteOrigin(req);
    // Retour de paiement toujours sur pro.ozeparis.com (hors dev local) : la
    // session de connexion doit être ouverte sur le domaine de l'espace pro
    // (une session b2b.* n'y serait pas visible). L'email pré-remplit la
    // connexion de la page de remerciement, qui ouvre ensuite le catalogue.
    const proOrigin = origin.startsWith('http://localhost') ? origin : PRO_SITE;
    const stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-06-20' });
    // Client Stripe créé avec l'identité et l'adresse de facturation saisies :
    // la facture du premier mois les porte (sinon Stripe n'aurait que l'email).
    const customer = await stripe.customers.create({
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
      metadata: { reseller_id: reseller.id },
    });
    const url = await createSubscriptionCheckout(stripe, {
      plan,
      resellerId: reseller.id,
      email: input.email,
      customerId: customer.id,
      successUrl: `${proOrigin}/inscription/merci?email=${encodeURIComponent(input.email)}`,
      // Paiement abandonné : le compte existe, la page d'inscription l'explique
      // et renvoie vers la connexion pour finaliser.
      cancelUrl: `${origin}/inscription?pass=${plan}&paiement=annule`,
    });

    return reply({ url });
  } catch (err) {
    console.error('[b2b-signup] Échec, annulation du compte créé :', err instanceof Error ? err.message : err);
    await rollback();
    return reply({ error: 'L\'inscription a échoué, réessayez dans un instant.' }, 500);
  }
});
