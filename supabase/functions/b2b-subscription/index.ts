// Edge Function : b2b-subscription
//
// Gestion de son abonnement Club B2B par l'abonné lui-même (voir 0167) :
//   - action "upgrade" : Pass Drops → Pass Revendeur. Stripe facture
//     immédiatement la différence au prorata du mois en cours sur la carte
//     enregistrée (proration_behavior = always_invoice) ; si le paiement
//     échoue, rien ne change (payment_behavior = error_if_incomplete).
//   - action "cancel" : résiliation à la fin de la période déjà payée
//     (cancel_at_period_end) — l'accès est coupé par le webhook
//     (customer.subscription.deleted) à l'échéance.
//   - action "resume" : annule une résiliation programmée.
//
// La base est mise à jour tout de suite (réponse immédiate dans l'interface),
// puis confirmée par le webhook customer.subscription.updated.
//
// Secrets : STRIPE_SECRET_KEY, STRIPE_PRICE_REVENDEUR (id "price_..." du Pass Revendeur)
// Déploiement : `supabase functions deploy b2b-subscription`

import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@17.7.0?target=deno';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const periodEnd = (subscription: Stripe.Subscription): string | null => {
  const raw =
    (subscription as unknown as { current_period_end?: number }).current_period_end ??
    (subscription.items.data[0] as unknown as { current_period_end?: number } | undefined)?.current_period_end;
  return raw ? new Date(raw * 1000).toISOString() : null;
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
    if (!['upgrade', 'cancel', 'resume'].includes(action)) return reply({ error: 'Action inconnue' }, 400);

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: contact } = await admin
      .from('reseller_contacts')
      .select('reseller_id, resellers!inner(id, account_type, status, subscription_plan, stripe_subscription_id)')
      .eq('profile_id', user.id)
      .maybeSingle();
    const reseller = contact && (Array.isArray(contact.resellers) ? contact.resellers[0] : contact.resellers);

    if (!reseller || reseller.account_type !== 'subscriber' || !reseller.stripe_subscription_id) {
      return reply({ error: 'Aucun abonnement associé à ce compte' }, 403);
    }
    if (reseller.status !== 'active') return reply({ error: 'Votre abonnement n\'est plus actif' }, 403);

    const stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-06-20' });
    const current = await stripe.subscriptions.retrieve(reseller.stripe_subscription_id);
    let updated: Stripe.Subscription;

    if (action === 'upgrade') {
      if (reseller.subscription_plan !== 'drops') return reply({ error: 'Vous avez déjà le Pass Revendeur' }, 400);
      const revendeurPrice = Deno.env.get('STRIPE_PRICE_REVENDEUR');
      if (!revendeurPrice) return reply({ error: 'Configuration serveur manquante (prix Pass Revendeur)' }, 500);
      try {
        updated = await stripe.subscriptions.update(current.id, {
          items: [{ id: current.items.data[0].id, price: revendeurPrice }],
          proration_behavior: 'always_invoice',
          payment_behavior: 'error_if_incomplete',
          // Passer au pass supérieur annule une éventuelle résiliation programmée.
          cancel_at_period_end: false,
        });
      } catch (err) {
        return reply({
          error: `Le paiement de la différence a échoué : ${err instanceof Error ? err.message : 'erreur inconnue'}. Vérifiez votre moyen de paiement.`,
        }, 402);
      }
    } else {
      updated = await stripe.subscriptions.update(current.id, { cancel_at_period_end: action === 'cancel' });
    }

    const columns = {
      subscription_plan: action === 'upgrade' ? 'revendeur' : reseller.subscription_plan,
      subscription_status: updated.status,
      subscription_current_period_end: periodEnd(updated),
      subscription_cancel_at_period_end: Boolean(updated.cancel_at_period_end),
    };
    const { error: updateError } = await admin.from('resellers').update(columns).eq('id', reseller.id);
    if (updateError) return reply({ error: updateError.message }, 500);

    return reply({ success: true, ...columns });
  } catch (err) {
    return reply({ error: err instanceof Error ? err.message : 'Erreur inconnue' }, 500);
  }
});
