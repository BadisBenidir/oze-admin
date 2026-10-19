// Edge Function : community-subscription
//
// Abonnement mensuel d'un membre de communauté partenaire (ex. Aurel Vinted),
// au prix de son groupe d'accès (community_group_prices 0212, groupes 0211,
// suivi 0214) :
//   - action "status"   : état de l'abonnement (Stripe en direct : statut,
//                         prix, échéance, résiliation programmée, carte) et
//                         prix d'un (ré)abonnement ;
//   - action "checkout" : session Stripe Checkout (mode abonnement). Le
//                         webhook b2b-stripe-webhook (community.ts) enregistre
//                         l'abonnement sur la ligne reseller_contacts du membre ;
//   - action "portal"   : portail client Stripe (changer de carte, factures) ;
//   - action "cancel"   : résiliation à la fin du mois déjà payé ;
//   - action "resume"   : annule une résiliation programmée ;
//   - action "invoices" : factures Stripe du membre.
//
// Prix : premier abonnement = prix du groupe (prochain prix programmé, sinon
// prix en vigueur). Réabonnement après une résiliation = jamais moins que le
// prix public des nouveaux membres (groupe 4) : un tarif réduit est perdu
// dès que l'abonnement s'arrête, et suit le prix du groupe 4 s'il évolue.
//
// Secrets : STRIPE_SECRET_KEY
// Déploiement : `supabase functions deploy community-subscription`

import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@17.7.0?target=deno';
import { siteOrigin } from '../_shared/subscriptionCheckout.ts';

const ONGOING_STATUSES = new Set(['active', 'trialing', 'past_due']);
/** Groupe des nouveaux membres : son prix est le prix public de la communauté. */
const PUBLIC_GROUP = 4;
const ACTIONS = ['status', 'checkout', 'portal', 'cancel', 'resume', 'invoices'];

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const todayKey = () => new Date().toISOString().slice(0, 10);

const periodEnd = (subscription: Stripe.Subscription): string | null => {
  const raw =
    (subscription as unknown as { current_period_end?: number }).current_period_end ??
    (subscription.items.data[0] as unknown as { current_period_end?: number } | undefined)?.current_period_end;
  return raw ? new Date(raw * 1000).toISOString() : null;
};

/** Prix mensuel d'un groupe : prochain changement programmé, sinon prix en vigueur. */
const groupPrice = async (admin: SupabaseClient, resellerId: string, group: number) => {
  const { data } = await admin
    .from('community_group_prices')
    .select('id, monthly_price, effective_from')
    .eq('reseller_id', resellerId)
    .eq('member_group', group)
    .order('effective_from', { ascending: true });
  const today = todayKey();
  const rows = (data || []).map((p) => ({ ...p, monthly_price: Number(p.monthly_price) }));
  return rows.find((p) => p.effective_from > today) ?? rows.filter((p) => p.effective_from <= today).pop() ?? null;
};

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
    if (!ACTIONS.includes(action)) return reply({ error: 'Action inconnue' }, 400);

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: contact } = await admin
      .from('reseller_contacts')
      .select('id, reseller_id, is_primary, member_group, community_sub_status, community_sub_stripe_subscription_id, community_sub_stripe_customer_id, resellers!inner(company_name, account_type), profiles!inner(first_name, last_name, email)')
      .eq('profile_id', user.id)
      .maybeSingle();
    if (!contact) return reply({ error: 'Compte membre introuvable' }, 404);

    const reseller = Array.isArray(contact.resellers) ? contact.resellers[0] : contact.resellers;
    const profile = Array.isArray(contact.profiles) ? contact.profiles[0] : contact.profiles;
    if (reseller?.account_type === 'subscriber') return reply({ error: 'Votre compte a déjà son propre abonnement Club' }, 400);
    if (contact.is_primary) return reply({ error: 'Le contact principal n\'a pas d\'abonnement membre' }, 400);

    const stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-06-20' });
    const ongoing = Boolean(contact.community_sub_status && ONGOING_STATUSES.has(contact.community_sub_status));
    const everSubscribed = Boolean(contact.community_sub_stripe_subscription_id);

    /** Prix d'un nouvel abonnement pour ce membre (null = rien à payer / pas de prix fixé). */
    const subscribePrice = async () => {
      if (!contact.member_group) return null;
      const own = await groupPrice(admin, contact.reseller_id, contact.member_group);
      if (!everSubscribed) return own;
      // Réabonnement : le tarif réduit est perdu, prix public au minimum.
      const pub = contact.member_group === PUBLIC_GROUP ? own : await groupPrice(admin, contact.reseller_id, PUBLIC_GROUP);
      if (!own) return pub;
      if (!pub) return own;
      return pub.monthly_price > own.monthly_price ? pub : own;
    };

    if (action === 'status') {
      const price = ongoing ? null : await subscribePrice();
      const pub = await groupPrice(admin, contact.reseller_id, PUBLIC_GROUP);
      const base = {
        member_group: contact.member_group,
        public_price: pub && pub.monthly_price > 0 ? pub.monthly_price : null,
        resubscribe: everSubscribed && !ongoing,
        subscribe_price: price && price.monthly_price > 0 ? price.monthly_price : null,
      };
      if (!contact.community_sub_stripe_subscription_id) return reply({ ...base, subscription: null });

      const sub = await stripe.subscriptions.retrieve(contact.community_sub_stripe_subscription_id, {
        expand: ['default_payment_method'],
      });
      const pm = sub.default_payment_method && typeof sub.default_payment_method === 'object' ? sub.default_payment_method : null;
      let card = pm?.card ? { brand: pm.card.brand, last4: pm.card.last4, exp_month: pm.card.exp_month, exp_year: pm.card.exp_year } : null;
      if (!card && contact.community_sub_stripe_customer_id) {
        const methods = await stripe.paymentMethods.list({ customer: contact.community_sub_stripe_customer_id, type: 'card', limit: 1 });
        const c = methods.data[0]?.card;
        if (c) card = { brand: c.brand, last4: c.last4, exp_month: c.exp_month, exp_year: c.exp_year };
      }
      // Statut tenu à jour au passage (rattrape un webhook manqué).
      if (sub.status !== contact.community_sub_status) {
        await admin.from('reseller_contacts').update({ community_sub_status: sub.status, community_sub_current_period_end: periodEnd(sub) }).eq('id', contact.id);
      }
      return reply({
        ...base,
        resubscribe: everSubscribed && !ONGOING_STATUSES.has(sub.status),
        subscription: {
          status: sub.status,
          monthly_price: (sub.items.data[0]?.price?.unit_amount ?? 0) / 100,
          current_period_end: periodEnd(sub),
          cancel_at_period_end: Boolean(sub.cancel_at_period_end),
          started_at: new Date(sub.start_date * 1000).toISOString(),
          card,
        },
      });
    }

    if (action === 'invoices') {
      if (!contact.community_sub_stripe_customer_id) return reply({ invoices: [] });
      const invoices = [];
      for await (const inv of stripe.invoices.list({ customer: contact.community_sub_stripe_customer_id, limit: 100 })) {
        if (inv.status === 'draft' || inv.status === 'void') continue;
        invoices.push({
          id: inv.id,
          number: inv.number,
          created: new Date(inv.created * 1000).toISOString(),
          amount: (inv.status === 'paid' ? inv.amount_paid : inv.amount_due) / 100,
          status: inv.status,
          hosted_invoice_url: inv.hosted_invoice_url,
          invoice_pdf: inv.invoice_pdf,
        });
        if (invoices.length >= 60) break;
      }
      return reply({ invoices });
    }

    if (action === 'portal') {
      if (!contact.community_sub_stripe_customer_id) return reply({ error: 'Aucun moyen de paiement enregistré pour ce compte' }, 400);
      const session = await stripe.billingPortal.sessions.create({
        customer: contact.community_sub_stripe_customer_id,
        return_url: `${siteOrigin(req)}/mon-profil`,
        locale: 'fr',
      });
      return reply({ url: session.url });
    }

    if (action === 'cancel' || action === 'resume') {
      if (!contact.community_sub_stripe_subscription_id || !ongoing) return reply({ error: 'Aucun abonnement en cours' }, 400);
      const updated = await stripe.subscriptions.update(contact.community_sub_stripe_subscription_id, {
        cancel_at_period_end: action === 'cancel',
      });
      await admin
        .from('reseller_contacts')
        .update({ community_sub_status: updated.status, community_sub_current_period_end: periodEnd(updated) })
        .eq('id', contact.id);
      return reply({ success: true, cancel_at_period_end: Boolean(updated.cancel_at_period_end), current_period_end: periodEnd(updated) });
    }

    // action === 'checkout'
    if (!contact.member_group) return reply({ error: 'Votre groupe d\'accès n\'est pas encore défini : contactez votre responsable' }, 400);
    if (ongoing) return reply({ error: 'Votre abonnement est déjà actif' }, 409);
    const price = await subscribePrice();
    if (!price) return reply({ error: 'Aucun prix d\'abonnement n\'est encore fixé pour votre groupe' }, 400);
    const amountCents = Math.round(price.monthly_price * 100);
    if (amountCents <= 0) return reply({ error: 'Votre accès ne nécessite aucun abonnement payant' }, 400);

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
      resubscribe: everSubscribed ? 'true' : 'false',
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
      success_url: `${origin}/mon-profil?abonnement_membre=ok`,
      cancel_url: `${origin}/mon-profil`,
    });
    if (!session.url) return reply({ error: 'Session Stripe sans URL' }, 500);
    return reply({ url: session.url });
  } catch (err) {
    return reply({ error: err instanceof Error ? err.message : 'Erreur inconnue' }, 500);
  }
});
