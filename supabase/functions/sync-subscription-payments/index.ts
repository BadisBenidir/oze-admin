// Edge Function : sync-subscription-payments
//
// Rattrapage du CA des abonnements Club B2B (0185) : relit chez Stripe toutes
// les factures payées des abonnés et les enregistre dans
// b2b_subscription_payments (idempotent : relancer ne crée aucun doublon).
// Le webhook (invoice.paid) enregistre ensuite chaque nouveau paiement.
// Réservée aux admins (bouton « Synchroniser » de la page Abonnés).
//
// Secrets : STRIPE_SECRET_KEY, STRIPE_PRICE_DROPS, STRIPE_PRICE_REVENDEUR
// Déploiement : `supabase functions deploy sync-subscription-payments`

import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@17.7.0?target=deno';
import { recordSubscriptionInvoice } from '../_shared/subscriptionPayments.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return reply({ error: 'Non authentifié' }, 401);
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeSecretKey) return reply({ error: 'Configuration serveur manquante' }, 500);

    const caller = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return reply({ error: 'Non authentifié' }, 401);

    const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: me } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle();
    if (me?.role !== 'admin') return reply({ error: 'Accès refusé' }, 403);

    const { data: subscribers, error } = await admin
      .from('resellers')
      .select('stripe_customer_id')
      .eq('account_type', 'subscriber')
      .not('stripe_customer_id', 'is', null);
    if (error) return reply({ error: error.message }, 500);

    const stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-06-20' });
    let recorded = 0;
    for (const s of subscribers || []) {
      for await (const invoice of stripe.invoices.list({ customer: s.stripe_customer_id as string, status: 'paid', limit: 100 })) {
        if (await recordSubscriptionInvoice(admin, invoice)) recorded += 1;
      }
    }
    return reply({ recorded, subscribers: (subscribers || []).length });
  } catch (err) {
    return reply({ error: err instanceof Error ? err.message : 'Erreur inconnue' }, 500);
  }
});
