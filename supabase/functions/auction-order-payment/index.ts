// Edge Function : auction-order-payment
//
// Paiement d'un lot d'enchère adjugé (commande déjà créée par
// admin_generate_order_from_auction_item / admin_close_auction_session,
// payment_status='pending') — soit par solde portefeuille (débit DIRECT via
// pay_auction_order_with_wallet, jamais via credit_wallet_topup donc jamais
// de bonus de recharge), soit par carte Stripe (nouvelle session, finalisée
// plus tard par b2b-stripe-webhook via confirm_auction_order_payment).
//
// Déploiement : `supabase functions deploy auction-order-payment`

import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@17.7.0?target=deno';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Non authentifié' }, 401);

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await callerClient.auth.getUser();
    if (userError || !user) return json({ error: 'Non authentifié' }, 401);

    const { order_id, payment_method } = await req.json();
    if (!order_id || !['wallet', 'card'].includes(payment_method)) {
      return json({ error: 'Paramètres invalides' }, 400);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: order, error: orderError } = await adminClient
      .from('orders')
      .select('id, total_amount, payment_status, placed_by_profile_id, order_channel, order_number, email')
      .eq('id', order_id)
      .maybeSingle();

    if (orderError) return json({ error: orderError.message }, 400);
    if (!order || order.order_channel !== 'b2b') return json({ error: 'Commande introuvable' }, 404);
    // Seul le gagnant du lot (celui qui a passé la commande) peut la payer —
    // même règle que cancel-my-b2b-order-item.
    if (order.placed_by_profile_id !== user.id) return json({ error: 'Cette commande ne vous appartient pas' }, 403);
    if (order.payment_status === 'paid') return json({ error: 'Cette commande est déjà payée' }, 400);

    if (payment_method === 'wallet') {
      // Via callerClient (pas adminClient) : pay_auction_order_with_wallet lit
      // auth.uid() pour vérifier lui-même le propriétaire de la commande.
      const { data, error } = await callerClient.rpc('pay_auction_order_with_wallet', { p_order_id: order_id });
      if (error) {
        const insufficient = error.message?.includes('Solde insuffisant');
        return json({ error: insufficient ? 'Solde insuffisant' : error.message }, insufficient ? 402 : 400);
      }
      return json({ success: true, already_paid: Boolean((data as { already_paid?: boolean } | null)?.already_paid) });
    }

    // payment_method === 'card'
    if (!stripeSecretKey) {
      return json({ error: 'STRIPE_SECRET_KEY manquant dans les secrets Supabase' }, 500);
    }
    const stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-06-20' });
    const origin = req.headers.get('origin') || 'https://admin.ozeparis.com';

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: { name: `Lot d'enchère — commande ${order.order_number}` },
          unit_amount: Math.round(Number(order.total_amount) * 100),
        },
        quantity: 1,
      }],
      customer_email: order.email || user.email || undefined,
      metadata: {
        type: 'auction_payment',
        order_id,
      },
      success_url: `${origin}/?b2b_checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?b2b_checkout=cancel`,
    });

    return json({ url: session.url });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Erreur inconnue' }, 500);
  }
});
