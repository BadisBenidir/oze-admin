// Edge Function : cancel-delivery-request
//
// Annule une demande de livraison B2B pas encore étiquetée — RÉSERVÉ AUX
// ADMINS OZË (profiles.role='admin'). Aucun appel Sendcloud : appelle
// admin_cancel_delivery_request_core (0159 : demande 'cancelled', articles
// remis "en acheminement", notification au revendeur), puis rembourse les
// frais de port selon le choix de l'admin :
//   - 'stripe' : remboursement sur la carte (paiement retrouvé via la session
//     Checkout de la demande, voir b2b-request-delivery-checkout) ;
//   - 'wallet' : crédit sur le solde du demandeur ;
//   - 'none'   : aucun remboursement.
//
// Déploiement : `supabase functions deploy cancel-delivery-request`

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

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Non authentifié' }, 401);

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await callerClient.auth.getUser();
    if (userError || !user) return json({ error: 'Non authentifié' }, 401);

    const { data: callerProfile } = await callerClient
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();
    if (callerProfile?.role !== 'admin') {
      return json({ error: 'Action réservée aux administrateurs' }, 403);
    }

    const { shipment_id, reason, refund_method } = await req.json();
    if (!shipment_id || !reason || !['wallet', 'stripe', 'none'].includes(refund_method)) {
      return json({ error: 'shipment_id, reason et refund_method (wallet, stripe ou none) sont requis' }, 400);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: result, error: rpcError } = await adminClient.rpc('admin_cancel_delivery_request_core', {
      p_shipment_id: shipment_id,
      p_reason: reason,
      p_refund_method: refund_method,
    });
    if (rpcError) return json({ error: rpcError.message }, 400);

    const shippingCost = Number(result?.shipping_cost) || 0;
    if (refund_method === 'none' || shippingCost <= 0) {
      return json({ success: true, item_count: result?.item_count, refund_status: 'not_applicable' });
    }

    // Un échec du remboursement n'annule pas l'annulation déjà actée —
    // il est enregistré sur la demande pour traitement manuel.
    let refundError: string | null = null;

    if (refund_method === 'stripe') {
      const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');
      if (!stripeSecretKey) {
        refundError = 'STRIPE_SECRET_KEY manquant côté serveur';
      } else {
        try {
          const stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-06-20' });
          const session = await stripe.checkout.sessions.retrieve(result.stripe_session_id);
          const paymentIntent = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
          if (!paymentIntent) {
            refundError = 'Paiement Stripe introuvable pour cette demande';
          } else {
            await stripe.refunds.create({ payment_intent: paymentIntent, amount: Math.round(shippingCost * 100) });
          }
        } catch (err) {
          refundError = `Stripe : ${err instanceof Error ? err.message : 'erreur inconnue'}`;
        }
      }
    } else {
      const { error: walletError } = await adminClient.rpc('credit_order_item_refund_to_wallet', {
        p_profile_id: result.profile_id,
        p_reseller_id: result.reseller_id,
        p_amount: shippingCost,
        p_order_id: null,
        p_note: `Remboursement frais de port (demande de livraison annulée) — ${shipment_id}`,
      });
      if (walletError) refundError = `Crédit solde : ${walletError.message}`;
    }

    const refundStatus = refundError ? 'failed' : 'succeeded';
    await adminClient
      .from('shipments')
      .update({ shipping_refund_status: refundStatus, shipping_refund_error: refundError })
      .eq('id', shipment_id);

    return json({
      success: true,
      item_count: result?.item_count,
      refund_status: refundStatus,
      refund_method,
      refunded_amount: refundError ? 0 : shippingCost,
      refund_error: refundError ?? undefined,
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Erreur inconnue' }, 500);
  }
});
