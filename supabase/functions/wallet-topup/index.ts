// Edge Function : wallet-topup
//
// Crée une session de paiement Stripe pour recharger le solde/portefeuille
// B2B d'un revendeur. Ne crédite RIEN ici : le crédit n'a lieu qu'après
// paiement confirmé, via b2b-stripe-webhook (branche metadata.type ===
// 'wallet_topup' → credit_wallet_topup). Même principe de confiance que
// b2b-checkout : le montant est validé côté serveur (bornes min/max), jamais
// simplement recopié depuis le corps de la requête sans contrôle.
// Déploiement : `supabase functions deploy wallet-topup`

import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@17.7.0?target=deno';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MIN_AMOUNT = 10;
const MAX_AMOUNT = 5000;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Non authentifié' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');

    if (!stripeSecretKey) {
      return new Response(JSON.stringify({ error: 'STRIPE_SECRET_KEY manquant dans les secrets Supabase' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await callerClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Non authentifié' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: resellerId } = await callerClient.rpc('current_reseller_id');
    if (!resellerId) {
      return new Response(JSON.stringify({ error: 'Aucun compte revendeur actif associé à cet utilisateur' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { amount } = await req.json();
    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount < MIN_AMOUNT || parsedAmount > MAX_AMOUNT) {
      return new Response(JSON.stringify({ error: `Le montant doit être compris entre ${MIN_AMOUNT} € et ${MAX_AMOUNT} €` }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-06-20' });
    const origin = req.headers.get('origin') || 'https://admin.ozeparis.com';

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'eur',
            product_data: { name: 'Recharge du solde OZË PARIS' },
            unit_amount: Math.round(parsedAmount * 100),
          },
          quantity: 1,
        },
      ],
      customer_email: user.email || undefined,
      metadata: {
        type: 'wallet_topup',
        profile_id: user.id,
        reseller_id: resellerId,
        amount: String(parsedAmount),
      },
      success_url: `${origin}/?wallet_topup=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?wallet_topup=cancel`,
    });

    return new Response(JSON.stringify({ url: session.url }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Erreur inconnue' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
