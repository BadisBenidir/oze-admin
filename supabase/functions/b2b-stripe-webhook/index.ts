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
//
// Logs : Supabase Dashboard → Edge Functions → b2b-stripe-webhook → Logs.
// Chaque étape clé logue explicitement en cas d'échec (voir LOG_PREFIX).

import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@17.7.0?target=deno';

const LOG_PREFIX = '[b2b-stripe-webhook]';

Deno.serve(async (req: Request) => {
  const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  if (!stripeSecretKey || !webhookSecret) {
    console.error(`${LOG_PREFIX} Configuration manquante — STRIPE_SECRET_KEY: ${!!stripeSecretKey}, STRIPE_WEBHOOK_SECRET: ${!!webhookSecret}`);
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
    console.error(`${LOG_PREFIX} Signature Stripe invalide:`, (err as Error).message);
    return new Response('Signature invalide', { status: 400 });
  }

  console.log(`${LOG_PREFIX} Événement reçu: ${event.type} (${event.id})`);

  if (event.type !== 'checkout.session.completed') {
    return new Response(JSON.stringify({ received: true }), { status: 200 });
  }

  const session = event.data.object as Stripe.Checkout.Session;
  const metadata = session.metadata || {};
  console.log(`${LOG_PREFIX} Session ${session.id} — reseller_id: ${metadata.reseller_id}, product_ids bruts: ${metadata.product_ids}`);

  try {
    let productIds: string[];
    let shippingAddress: Record<string, unknown>;
    let billingAddress: Record<string, unknown>;
    let insuredProductIds: string[];
    try {
      productIds = JSON.parse(metadata.product_ids || '[]');
      shippingAddress = JSON.parse(metadata.shipping_address || '{}');
      billingAddress = JSON.parse(metadata.billing_address || '{}');
      insuredProductIds = JSON.parse(metadata.insured_product_ids || '[]');
    } catch (parseErr) {
      console.error(`${LOG_PREFIX} Échec de parsing des metadata Stripe:`, (parseErr as Error).message, '— metadata brutes:', JSON.stringify(metadata));
      return new Response(JSON.stringify({ error: 'Metadata Stripe invalides' }), { status: 400 });
    }

    if (!Array.isArray(productIds) || productIds.length === 0) {
      console.error(`${LOG_PREFIX} product_ids vide ou invalide après parsing:`, metadata.product_ids);
      return new Response(JSON.stringify({ error: 'product_ids invalide' }), { status: 400 });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const rpcParams = {
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
      p_discount_rate: metadata.discount_rate ? Number(metadata.discount_rate) : 0,
      p_discount_amount: metadata.discount_amount ? Number(metadata.discount_amount) : 0,
    };
    console.log(`${LOG_PREFIX} Appel confirm_b2b_payment pour la session ${session.id}, ${productIds.length} article(s)`);

    const { data, error } = await adminClient.rpc('confirm_b2b_payment', rpcParams);

    if (error) {
      // Logué en détail : un message générique ("[object Object]") ne dit
      // rien sur la vraie cause (fonction introuvable, mauvaise signature,
      // contrainte violée...). code/details/hint viennent directement de
      // Postgres/PostgREST et sont la partie utile du diagnostic.
      console.error(`${LOG_PREFIX} ÉCHEC confirm_b2b_payment pour la session ${session.id}`);
      console.error(`${LOG_PREFIX}   message: ${error.message}`);
      console.error(`${LOG_PREFIX}   code: ${error.code ?? 'n/a'}`);
      console.error(`${LOG_PREFIX}   details: ${error.details ?? 'n/a'}`);
      console.error(`${LOG_PREFIX}   hint: ${error.hint ?? 'n/a'}`);
      console.error(`${LOG_PREFIX}   params envoyés:`, JSON.stringify(rpcParams));
      return new Response(JSON.stringify({ error: error.message, code: error.code }), { status: 500 });
    }

    if (!data?.order_id && !data?.already_processed) {
      console.error(`${LOG_PREFIX} confirm_b2b_payment n'a renvoyé aucun order_id pour la session ${session.id} — réponse:`, JSON.stringify(data));
    } else {
      console.log(`${LOG_PREFIX} Commande ${data.order_id} confirmée pour la session ${session.id} (already_processed: ${!!data.already_processed})`);
    }

    const unavailableIds: string[] = data?.unavailable_ids || [];

    // Si certains articles facturés n'ont finalement pas pu être honorés
    // (vendus entre-temps), on rembourse la différence au lieu de garder
    // l'argent pour rien.
    if (unavailableIds.length > 0 && session.amount_total) {
      console.log(`${LOG_PREFIX} ${unavailableIds.length} article(s) devenus indisponibles, remboursement partiel en cours:`, unavailableIds);
      const { data: unavailableProducts, error: productsError } = await adminClient
        .from('products')
        .select('id, sale_price')
        .in('id', unavailableIds);

      if (productsError) {
        console.error(`${LOG_PREFIX} Échec de lecture des produits indisponibles pour remboursement:`, productsError.message);
      }

      const refundAmount = (unavailableProducts || []).reduce(
        (sum, p) => sum + Math.round(Number(p.sale_price) * 100),
        0
      );

      if (refundAmount > 0 && typeof session.payment_intent === 'string') {
        try {
          await stripe.refunds.create({
            payment_intent: session.payment_intent,
            amount: refundAmount,
          });
          console.log(`${LOG_PREFIX} Remboursement de ${refundAmount / 100}€ effectué sur ${session.payment_intent}`);
        } catch (refundErr) {
          console.error(`${LOG_PREFIX} Échec du remboursement Stripe:`, (refundErr as Error).message);
        }
      }
    }

    return new Response(JSON.stringify({ received: true, order_id: data?.order_id }), { status: 200 });
  } catch (err) {
    console.error(`${LOG_PREFIX} Erreur non gérée dans le traitement du webhook (session ${session.id}):`, err instanceof Error ? err.stack || err.message : err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Erreur inconnue' }), {
      status: 500,
    });
  }
});
