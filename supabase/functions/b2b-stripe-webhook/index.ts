// Edge Function : b2b-stripe-webhook
//
// Reçoit les événements Stripe pour le paiement B2B. C'est le SEUL endroit
// où une commande B2B payée est effectivement créée (via confirm_b2b_payment,
// réservée au rôle service_role) — jamais côté client, jamais avant
// confirmation réelle du paiement.
//
// À configurer manuellement dans le dashboard Stripe :
//   Endpoint URL : https://<project-ref>.supabase.co/functions/v1/b2b-stripe-webhook
//   Événement    : checkout.session.completed
//   → copier le "Signing secret" dans le secret Supabase STRIPE_WEBHOOK_SECRET
//
// Déploiement : `supabase functions deploy b2b-stripe-webhook --no-verify-jwt`
// (--no-verify-jwt est nécessaire : Stripe n'envoie pas de JWT Supabase, la
// sécurité vient de la vérification de signature ci-dessous, pas de l'auth JWT)

import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@17.7.0?target=deno';

Deno.serve(async (req: Request) => {
  const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  if (!stripeSecretKey || !webhookSecret) {
    console.error('STRIPE_SECRET_KEY ou STRIPE_WEBHOOK_SECRET manquant');
    return new Response('Configuration serveur manquante', { status: 500 });
  }

  const stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-06-20' });
  const signature = req.headers.get('Stripe-Signature');
  const body = await req.text();

  let event: Stripe.Event;
  try {
    // constructEventAsync + SubtleCryptoProvider : Deno n'a pas l'API crypto
    // synchrone que Stripe utilise par défaut côté Node.
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature!,
      webhookSecret,
      undefined,
      Stripe.createSubtleCryptoProvider()
    );
  } catch (err) {
    console.error('Signature Stripe invalide:', err);
    return new Response('Signature invalide', { status: 400 });
  }

  if (event.type !== 'checkout.session.completed') {
    return new Response(JSON.stringify({ received: true }), { status: 200 });
  }

  const session = event.data.object as Stripe.Checkout.Session;
  const metadata = session.metadata || {};

  try {
    const productIds = JSON.parse(metadata.product_ids || '[]');
    const shippingAddress = JSON.parse(metadata.shipping_address || '{}');
    const billingAddress = JSON.parse(metadata.billing_address || '{}');
    const insuredProductIds = JSON.parse(metadata.insured_product_ids || '[]');

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data, error } = await adminClient.rpc('confirm_b2b_payment', {
      p_reseller_id: metadata.reseller_id,
      p_product_ids: productIds,
      p_shipping_address: shippingAddress,
      p_billing_address: billingAddress,
      p_stripe_session_id: session.id,
      p_stripe_payment_intent_id: typeof session.payment_intent === 'string' ? session.payment_intent : null,
      p_email: metadata.email || session.customer_email || '',
      p_placed_by_profile_id: metadata.placed_by_profile_id || null,
      p_shipping_cost: metadata.shipping_cost ? Number(metadata.shipping_cost) : 0,
      p_insured_product_ids: insuredProductIds,
      p_insurance_cost: metadata.insurance_cost ? Number(metadata.insurance_cost) : 0,
      p_grouped_with_order_id: metadata.grouped_with_order_id || null,
      p_insured_value: metadata.insured_value ? Number(metadata.insured_value) : 0,
    });

    if (error) {
      console.error('Erreur confirm_b2b_payment:', error);
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    const unavailableIds: string[] = data?.unavailable_ids || [];

    // Si certains articles facturés n'ont finalement pas pu être honorés
    // (vendus entre-temps), on rembourse la différence au lieu de garder
    // l'argent pour rien.
    if (unavailableIds.length > 0 && session.amount_total) {
      const { data: unavailableProducts } = await adminClient
        .from('products')
        .select('id, sale_price')
        .in('id', unavailableIds);

      const refundAmount = (unavailableProducts || []).reduce(
        (sum, p) => sum + Math.round(Number(p.sale_price) * 100),
        0
      );

      if (refundAmount > 0 && typeof session.payment_intent === 'string') {
        await stripe.refunds.create({
          payment_intent: session.payment_intent,
          amount: refundAmount,
        });
      }
    }

    return new Response(JSON.stringify({ received: true, order_id: data?.order_id }), { status: 200 });
  } catch (err) {
    console.error('Erreur traitement webhook B2B:', err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Erreur inconnue' }), {
      status: 500,
    });
  }
});
