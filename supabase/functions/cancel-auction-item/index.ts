// Edge Function : cancel-auction-item
//
// Annule un lot d'enchère adjugé (payé ou non) — RÉSERVÉ AUX ADMINS OZË
// (profiles.role='admin'). Les revendeurs n'ont aucun moyen d'annuler un lot
// (0146 bloque toujours les chemins génériques). Appelle
// admin_cancel_auction_item_core (0156 : lot 'cancelled', commande annulée,
// produit remis au statut choisi), puis rembourse si le lot était payé :
//   - 'wallet' : tout ce qui a été payé (solde + carte) est crédité au solde ;
//   - 'stripe' : la part carte est remboursée sur Stripe, et la part solde
//     d'un paiement mixte revient au solde (elle n'a jamais été payée par
//     carte, Stripe ne peut pas la rembourser).
//
// Déploiement : `supabase functions deploy cancel-auction-item`

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

    const { item_id, reason, restock_action, refund_method } = await req.json();
    if (!item_id || !reason || !restock_action) {
      return json({ error: 'item_id, reason et restock_action sont requis' }, 400);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Valide aussi refund_method (requis si payé, Stripe impossible si payé
    // 100% solde) AVANT toute écriture — rien n'est annulé si ça échoue.
    const { data: result, error: rpcError } = await adminClient.rpc('admin_cancel_auction_item_core', {
      p_item_id: item_id,
      p_reason: reason,
      p_restock_action: restock_action,
      p_refund_method: refund_method ?? null,
    });
    if (rpcError) return json({ error: rpcError.message }, 400);

    if (!result?.is_paid) {
      return json({ success: true, refund_status: 'not_applicable', refund_method: null });
    }

    // Un échec du remboursement n'annule pas l'annulation déjà actée en base —
    // il est signalé (auction_items.refund_error) pour traitement manuel.
    const errors: string[] = [];
    let stripeRefundId: string | undefined;
    const walletPaid = Number(result.wallet_paid) || 0;
    const cardPaid = Number(result.card_paid) || 0;

    const creditWallet = async (amount: number) => {
      if (amount <= 0) return;
      const { error: walletError } = await adminClient.rpc('credit_order_item_refund_to_wallet', {
        p_profile_id: result.placed_by_profile_id,
        p_reseller_id: result.reseller_id,
        p_amount: amount,
        p_order_id: result.order_id,
        p_note: `Remboursement (lot d'enchère annulé) — commande ${result.order_id}`,
      });
      if (walletError) errors.push(`Crédit solde : ${walletError.message}`);
    };

    if (refund_method === 'stripe') {
      const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');
      if (!stripeSecretKey) {
        errors.push('STRIPE_SECRET_KEY manquant côté serveur');
      } else {
        try {
          const stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-06-20' });
          const refund = await stripe.refunds.create({
            payment_intent: result.stripe_payment_intent_id,
            amount: Math.round(cardPaid * 100),
          });
          stripeRefundId = refund.id;
        } catch (err) {
          errors.push(`Stripe : ${err instanceof Error ? err.message : 'erreur inconnue'}`);
        }
      }
      await creditWallet(walletPaid);
    } else {
      await creditWallet(walletPaid + cardPaid);
    }

    const refundStatus = errors.length ? 'failed' : 'succeeded';
    const refundError = errors.length ? errors.join(' · ') : null;

    await adminClient
      .from('auction_items')
      .update({ refund_status: refundStatus, refund_method, refund_error: refundError })
      .eq('id', item_id);
    await adminClient
      .from('order_items')
      .update({ refund_status: refundStatus, refund_method, stripe_refund_id: stripeRefundId ?? null, refund_error: refundError })
      .eq('order_id', result.order_id);

    return json({
      success: true,
      refund_status: refundStatus,
      refund_method,
      refund_error: refundError ?? undefined,
      wallet_refunded: refund_method === 'stripe' ? walletPaid : walletPaid + cardPaid,
      stripe_refunded: refund_method === 'stripe' ? cardPaid : 0,
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Erreur inconnue' }, 500);
  }
});
