// Edge Function : community-subscription
//
// Abonnement mensuel d'un membre de communauté partenaire (ex. Aurel Vinted),
// au prix de son groupe d'accès (community_group_prices 0212, groupes 0211) :
//   - action "checkout" : ouvre une session Stripe Checkout (mode abonnement,
//     prix mensuel du groupe : prochain prix programmé, sinon prix en
//     vigueur). Le webhook b2b-stripe-webhook (community.ts) enregistre
//     l'abonnement sur la ligne reseller_contacts du membre (0214).
// Jamais pour le contact principal, un membre non classé, un prix à 0 € ou
// un membre déjà abonné.
//
// Secrets : STRIPE_SECRET_KEY
// Déploiement : `supabase functions deploy community-subscription`

import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@17.7.0?target=deno';
import { siteOrigin } from '../_shared/subscriptionCheckout.ts';

const ONGOING_STATUSES = new Set(['active', 'trialing', 'past_due']);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const todayKey = () => new Date().toISOString().slice(0, 10);

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return reply({ error: 'Non authentifié' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeSecretKey) return reply({ error: 'Configuration serveur manquante' }, 500);

    const caller = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return reply({ error: 'Non authentifié' }, 401);

    const { action } = await req.json();
    if (action !== 'checkout') return reply({ error: 'Action inconnue' }, 400);

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: contact } = await admin
      .from('reseller_contacts')
      .select('id, reseller_id, is_primary, member_group, community_sub_status, community_sub_stripe_customer_id, resellers!inner(company_name, account_type), profiles!inner(first_name, last_name, email)')
      .eq('profile_id', user.id)
      .maybeSingle();
    if (!contact) return reply({ error: 'Compte membre introuvable' }, 404);

    const reseller = Array.isArray(contact.resellers) ? contact.resellers[0] : contact.resellers;
    const profile = Array.isArray(contact.profiles) ? contact.profiles[0] : contact.profiles;
    if (reseller?.account_type === 'subscriber') return reply({ error: 'Votre compte a déjà son propre abonnement Club' }, 400);
    if (contact.is_primary) return reply({ error: 'Le contact principal n\'a pas d\'abonnement membre' }, 400);
    if (!contact.member_group) return reply({ error: 'Votre groupe d\'accès n\'est pas encore défini : contactez votre responsable' }, 400);
    if (contact.community_sub_status && ONGOING_STATUSES.has(contact.community_sub_status)) {
      return reply({ error: 'Votre abonnement est déjà actif' }, 409);
    }

    // Prix du groupe : prochain changement programmé, sinon prix en vigueur.
    const { data: prices } = await admin
      .from('community_group_prices')
      .select('id, monthly_price, effective_from')
      .eq('reseller_id', contact.reseller_id)
      .eq('member_group', contact.member_group)
      .order('effective_from', { ascending: true });
    const today = todayKey();
    const rows = (prices || []).map((p) => ({ ...p, monthly_price: Number(p.monthly_price) }));
    const upcoming = rows.find((p) => p.effective_from > today);
    const current = rows.filter((p) => p.effective_from <= today).pop();
    const price = upcoming ?? current;
    if (!price) return reply({ error: 'Aucun prix d\'abonnement n\'est encore fixé pour votre groupe' }, 400);
    const amountCents = Math.round(price.monthly_price * 100);
    if (amountCents <= 0) return reply({ error: 'Votre accès ne nécessite aucun abonnement payant' }, 400);

    const stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-06-20' });

    // Paiement déjà passé mais webhook pas encore traité : jamais un second abonnement.
    try {
      const existing = await stripe.subscriptions.search({
        query: `metadata['contact_id']:'${contact.id}' AND status:'active'`,
        limit: 1,
      });
      if (existing.data.length > 0) {
        return reply({ error: 'Votre paiement est en cours de validation : rechargez la page dans un instant.' }, 409);
      }
    } catch (err) {
      console.warn('[community-subscription] recherche d\'abonnement impossible :', err instanceof Error ? err.message : err);
    }

    const metadata: Record<string, string> = {
      type: 'community_subscription',
      contact_id: contact.id,
      profile_id: user.id,
      reseller_id: contact.reseller_id,
      member_group: String(contact.member_group),
      price_id: price.id,
      monthly_price: price.monthly_price.toFixed(2),
    };
    const origin = siteOrigin(req);
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'eur',
            unit_amount: amountCents,
            recurring: { interval: 'month' },
            product_data: { name: `Abonnement OZË PARIS — ${reseller?.company_name || 'communauté'}` },
          },
        },
      ],
      ...(contact.community_sub_stripe_customer_id
        ? { customer: contact.community_sub_stripe_customer_id }
        : { customer_email: profile?.email || user.email! }),
      client_reference_id: contact.id,
      metadata,
      subscription_data: { metadata },
      locale: 'fr',
      expires_at: Math.floor(Date.now() / 1000) + 4 * 60 * 60,
      success_url: `${origin}/catalogue?abonnement_membre=ok`,
      cancel_url: `${origin}/catalogue`,
    });
    if (!session.url) return reply({ error: 'Session Stripe sans URL' }, 500);
    return reply({ url: session.url });
  } catch (err) {
    return reply({ error: err instanceof Error ? err.message : 'Erreur inconnue' }, 500);
  }
});
