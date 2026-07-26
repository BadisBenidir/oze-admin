// Edge Function : cancel-b2b-order
//
// Annule TOUS les articles actifs d'une commande B2B en une fois (contraste
// avec cancel-b2b-order-item, qui n'en annule qu'un). Appelle cancel_b2b_order
// (recalcul en une transaction), puis effectue UN SEUL remboursement pour le
// total — portefeuille ou Stripe, au choix de l'admin — plutôt qu'un par
// article. Réservé aux admins OZË (profiles.role='admin').
//
// Déploiement : `supabase functions deploy cancel-b2b-order`

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

    const { order_id, reason, restock_action, refund_method } = await req.json();
    if (!order_id || !reason || !restock_action) {
      return json({ error: 'order_id, reason et restock_action sont requis' }, 400);
    }
    if (!['draft', 'for-sale-b2b', 'archived'].includes(restock_action)) {
      return json({ error: 'restock_action invalide' }, 400);
    }
    if (refund_method && !['wallet', 'stripe'].includes(refund_method)) {
      return json({ error: 'refund_method invalide' }, 400);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: result, error: rpcError } = await adminClient.rpc('cancel_b2b_order', {
      p_order_id: order_id,
      p_reason: reason,
      p_restock_action: restock_action,
    });

    if (rpcError) {
      return json({ error: rpcError.message }, 400);
    }

    const itemIds: string[] = result?.order_item_ids || [];
    const totalRefund = Number(result?.total_refund || 0);

    let refundStatus: 'not_applicable' | 'succeeded' | 'failed' = 'not_applicable';
    let refundError: string | undefined;
    let refundId: string | undefined;
    let appliedMethod: string | null = null;

    if (result?.payment_status === 'paid' && totalRefund > 0) {
      if (!refund_method) {
        return json({ error: 'refund_method (wallet ou stripe) est requis pour cette commande payée' }, 400);
      }
      appliedMethod = refund_method;

      if (refund_method === 'stripe') {
        if (!result?.stripe_payment_intent_id) {
          return json({ error: "Aucun paiement Stripe à rembourser sur cette commande — choisissez le portefeuille." }, 400);
        }
        const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');
        if (!stripeSecretKey) {
          refundStatus = 'failed';
          refundError = 'STRIPE_SECRET_KEY manquant côté serveur';
        } else {
          try {
            const stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-06-20' });
            const refund = await stripe.refunds.create({
              payment_intent: result.stripe_payment_intent_id,
              amount: Math.round(totalRefund * 100),
            });
            refundStatus = 'succeeded';
            refundId = refund.id;
          } catch (err) {
            refundStatus = 'failed';
            refundError = err instanceof Error ? err.message : 'Erreur Stripe inconnue';
          }
        }
      } else {
        const { error: walletError } = await adminClient.rpc('credit_order_item_refund_to_wallet', {
          p_profile_id: result.placed_by_profile_id,
          p_reseller_id: result.reseller_id,
          p_amount: totalRefund,
          p_order_id: order_id,
          p_note: `Remboursement (commande annulée) — commande ${order_id}`,
        });
        if (walletError) {
          refundStatus = 'failed';
          refundError = walletError.message;
        } else {
          refundStatus = 'succeeded';
        }
      }
    }

    if (itemIds.length > 0) {
      await adminClient
        .from('order_items')
        .update({
          refund_status: refundStatus,
          refund_method: appliedMethod,
          stripe_refund_id: refundId ?? null,
          refund_error: refundError ?? null,
        })
        .in('id', itemIds);
    }

    return json({
      success: true,
      order_id,
      total_refund: totalRefund,
      refund_status: refundStatus,
      refund_method: appliedMethod,
      refund_error: refundError,
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Erreur inconnue' }, 500);
  }
});
