// Edge Function : cancel-b2b-order-item
//
// Annule UN article d'une commande B2B (pas la commande entière) : appelle
// cancel_b2b_order_item (recalcul atomique de subtotal/total_amount, bascule
// la commande en 'cancelled' si plus aucun article actif, remet le produit
// en vente/brouillon/archivé), puis effectue un remboursement Stripe partiel
// si la commande était payée. Réservé aux admins OZË (profiles.role='admin').
//
// Déploiement : `supabase functions deploy cancel-b2b-order-item`

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

    const { order_item_id, reason, restock_action } = await req.json();
    if (!order_item_id || !reason || !restock_action) {
      return json({ error: 'order_item_id, reason et restock_action sont requis' }, 400);
    }
    if (!['draft', 'for-sale-b2b', 'archived'].includes(restock_action)) {
      return json({ error: 'restock_action invalide' }, 400);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: result, error: rpcError } = await adminClient.rpc('cancel_b2b_order_item', {
      p_order_item_id: order_item_id,
      p_reason: reason,
      p_restock_action: restock_action,
    });

    if (rpcError) {
      return json({ error: rpcError.message }, 400);
    }

    // Remboursement Stripe partiel : uniquement si la commande a réellement
    // été payée par carte (payment_status='paid' + payment_intent connu).
    // Un échec du remboursement n'annule pas l'annulation déjà actée en
    // base (l'article reste annulé) — il est simplement signalé, à traiter
    // manuellement depuis le dashboard Stripe si besoin.
    let refundStatus: 'not_applicable' | 'succeeded' | 'failed' = 'not_applicable';
    let refundError: string | undefined;
    let refundId: string | undefined;

    if (result?.payment_status === 'paid' && result?.stripe_payment_intent_id) {
      const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');
      if (!stripeSecretKey) {
        refundStatus = 'failed';
        refundError = 'STRIPE_SECRET_KEY manquant côté serveur';
      } else {
        try {
          const stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-06-20' });
          const refund = await stripe.refunds.create({
            payment_intent: result.stripe_payment_intent_id,
            amount: Math.round(Number(result.line_total) * 100),
          });
          refundStatus = 'succeeded';
          refundId = refund.id;
        } catch (err) {
          refundStatus = 'failed';
          refundError = err instanceof Error ? err.message : 'Erreur Stripe inconnue';
        }
      }

      await adminClient
        .from('order_items')
        .update({ refund_status: refundStatus, stripe_refund_id: refundId ?? null })
        .eq('id', order_item_id);
    } else {
      await adminClient
        .from('order_items')
        .update({ refund_status: 'not_applicable' })
        .eq('id', order_item_id);
    }

    return json({
      success: true,
      order_id: result?.order_id,
      new_total_amount: result?.new_total_amount,
      order_status: result?.order_status,
      refund_status: refundStatus,
      refund_error: refundError,
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Erreur inconnue' }, 500);
  }
});
