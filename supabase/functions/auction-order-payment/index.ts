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
    if (!order_id || !['wallet', 'card', 'mixed'].includes(payment_method)) {
      return json({ error: 'Paramètres invalides' }, 400);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: order, error: orderError } = await adminClient
      .from('orders')
      .select('id, total_amount, payment_status, placed_by_profile_id, order_channel, order_number, email, reseller_id')
      .eq('id', order_id)
      .maybeSingle();

    if (orderError) return json({ error: orderError.message }, 400);
    if (!order || order.order_channel !== 'b2b') return json({ error: 'Commande introuvable' }, 404);
    // Seul le gagnant du lot (celui qui a passé la commande) peut la payer —
    // même règle que cancel-my-b2b-order-item.
    if (order.placed_by_profile_id !== user.id) return json({ error: 'Cette commande ne vous appartient pas' }, 403);
    if (order.payment_status === 'paid') return json({ error: 'Cette commande est déjà payée' }, 400);

    // Le lot doit être réellement adjugé (status='sold') avant tout paiement —
    // vérifié ICI, avant de créer la session Stripe, car une fois celle-ci
    // payée l'argent est débité : trop tard pour refuser à la confirmation
    // (confirm_auction_order_payment, 0144, ne fait que ce filet de sécurité
    // en dernier recours). pay_auction_order_with_wallet revérifie aussi
    // côté SQL (défense en profondeur si cette RPC est appelée directement).
    const { data: item, error: itemError } = await adminClient
      .from('auction_items')
      .select('status')
      .eq('order_id', order_id)
      .maybeSingle();
    if (itemError) return json({ error: itemError.message }, 400);
    if (!item || item.status !== 'sold') {
      return json({ error: "Ce lot n'a pas encore été adjugé — paiement impossible pour le moment" }, 409);
    }

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

    // payment_method === 'card' ou 'mixed'
    if (!stripeSecretKey) {
      return json({ error: 'STRIPE_SECRET_KEY manquant dans les secrets Supabase' }, 500);
    }

    const totalAmount = Number(order.total_amount);
    let mixedWalletAmount = 0;
    let chargeAmount = totalAmount;

    // Paiement mixte : débite IMMÉDIATEMENT tout le solde disponible (jamais
    // un montant choisi par le client), Stripe ne facture que le reste —
    // même principe que le panier B2B classique (0036).
    if (payment_method === 'mixed') {
      const { data: profileRow } = await adminClient
        .from('profiles')
        .select('wallet_balance')
        .eq('id', user.id)
        .single();
      const balance = Number(profileRow?.wallet_balance || 0);
      if (balance <= 0 || balance >= totalAmount) {
        return json({ error: "Paiement mixte non applicable : utilisez 'solde' (couvre tout) ou 'carte' (aucun solde à utiliser)" }, 400);
      }
      mixedWalletAmount = balance;
      chargeAmount = totalAmount - balance;
    }

    const stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-06-20' });
    const origin = req.headers.get('origin') || 'https://admin.ozeparis.com';

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: { name: `Lot d'enchère — commande ${order.order_number}` },
          unit_amount: Math.round(chargeAmount * 100),
        },
        quantity: 1,
      }],
      customer_email: order.email || user.email || undefined,
      metadata: {
        type: 'auction_payment',
        order_id,
        wallet_amount_used: String(mixedWalletAmount),
      },
      success_url: `${origin}/?b2b_checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?b2b_checkout=cancel`,
    });

    // Débite le solde MAINTENANT que la session existe (le débit est lié à
    // session.id pour être finalisé ou remboursé selon l'issue du paiement —
    // voir b2b-stripe-webhook). En cas d'échec (solde changé entre-temps), on
    // n'envoie surtout pas au client une session Stripe dont le montant
    // suppose à tort que le solde la complète : elle reste orpheline et
    // expire d'elle-même sans qu'aucune charge n'ait eu lieu.
    if (payment_method === 'mixed' && mixedWalletAmount > 0) {
      const { error: debitError } = await adminClient.rpc('debit_wallet_amount', {
        p_profile_id: user.id,
        p_reseller_id: order.reseller_id,
        p_amount: mixedWalletAmount,
        p_stripe_session_id: session.id,
      });
      if (debitError) {
        return json({ error: 'Le solde a changé entre-temps, réessayez le paiement.' }, 409);
      }
    }

    return json({ url: session.url });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Erreur inconnue' }, 500);
  }
});
