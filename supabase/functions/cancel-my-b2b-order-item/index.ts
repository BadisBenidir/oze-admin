// Edge Function : cancel-my-b2b-order-item
//
// Annulation en LIBRE-SERVICE côté revendeur (pas admin) : tout ou partie
// des articles ACTIFS d'une de ses propres commandes, tant qu'elle n'a pas
// encore été expédiée. Toujours remboursée en crédit portefeuille — jamais
// via Stripe, c'est une règle fixe côté client (voir spec) — et remise en
// vente sur le catalogue B2B ('for-sale-b2b'), jamais en brouillon/archivée.
//
// cancel_b2b_order_item/cancel_b2b_order sont SECURITY DEFINER et ne
// vérifient elles-mêmes AUCUNE autorisation (elles font confiance à
// l'appelant, jusqu'ici toujours l'admin via les Edge Functions dédiées) —
// c'est cette fonction qui doit donc vérifier que la commande appartient
// bien au revendeur connecté et qu'elle n'est pas déjà expédiée, AVANT
// d'appeler les RPC, sans quoi n'importe quel revendeur pourrait annuler
// n'importe quelle commande en devinant un UUID.
//
// Déploiement : `supabase functions deploy cancel-my-b2b-order-item`

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const RESTOCK_ACTION = 'for-sale-b2b';
const REASON = 'Annulation par le revendeur';

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

    const { order_id, item_ids } = await req.json();
    if (!order_id) {
      return json({ error: 'order_id est requis' }, 400);
    }
    if (item_ids && (!Array.isArray(item_ids) || item_ids.some((id: unknown) => typeof id !== 'string'))) {
      return json({ error: 'item_ids doit être un tableau d\'identifiants' }, 400);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: order, error: orderError } = await adminClient
      .from('orders')
      .select('id, status, reseller_id, placed_by_profile_id, order_channel')
      .eq('id', order_id)
      .maybeSingle();

    if (orderError) return json({ error: orderError.message }, 400);
    if (!order || order.order_channel !== 'b2b') {
      return json({ error: 'Commande introuvable' }, 404);
    }
    // Seul le profil qui a passé la commande peut l'annuler lui-même — pas
    // un simple collègue du même revendeur (voir useMyB2BOrders : "Mes
    // commandes" est déjà scopé par placed_by_profile_id, même logique ici).
    if (order.placed_by_profile_id !== user.id) {
      return json({ error: 'Cette commande ne vous appartient pas' }, 403);
    }
    if (['shipped', 'delivered', 'cancelled'].includes(order.status)) {
      return json({ error: 'Cette commande a déjà été expédiée et ne peut plus être annulée en ligne — contactez OZË Paris.' }, 400);
    }

    const { data: activeItems, error: itemsError } = await adminClient
      .from('order_items')
      .select('id, line_total, status')
      .eq('order_id', order_id)
      .eq('status', 'active');

    if (itemsError) return json({ error: itemsError.message }, 400);
    if (!activeItems || activeItems.length === 0) {
      return json({ error: 'Aucun article actif à annuler sur cette commande' }, 400);
    }

    let targetIds: string[];
    if (item_ids && item_ids.length > 0) {
      const activeIdSet = new Set(activeItems.map((i) => i.id));
      const invalid = item_ids.filter((id: string) => !activeIdSet.has(id));
      if (invalid.length > 0) {
        return json({ error: "Certains articles sélectionnés n'appartiennent pas à cette commande ou sont déjà annulés" }, 400);
      }
      targetIds = item_ids;
    } else {
      targetIds = activeItems.map((i) => i.id);
    }

    const cancellingWholeOrder = targetIds.length === activeItems.length;
    let totalRefund = 0;
    let cancelledOrderStatus: string | undefined;

    if (cancellingWholeOrder) {
      const { data: result, error: rpcError } = await adminClient.rpc('cancel_b2b_order', {
        p_order_id: order_id,
        p_reason: REASON,
        p_restock_action: RESTOCK_ACTION,
      });
      if (rpcError) return json({ error: rpcError.message }, 400);
      totalRefund = Number(result?.total_refund || 0);
      cancelledOrderStatus = 'cancelled';
    } else {
      for (const itemId of targetIds) {
        const { data: result, error: rpcError } = await adminClient.rpc('cancel_b2b_order_item', {
          p_order_item_id: itemId,
          p_reason: REASON,
          p_restock_action: RESTOCK_ACTION,
        });
        if (rpcError) return json({ error: rpcError.message }, 400);
        totalRefund += Number(result?.refund_amount || 0);
        cancelledOrderStatus = result?.order_status;
      }
    }

    let refundStatus: 'succeeded' | 'failed' = 'succeeded';
    let refundError: string | undefined;

    if (totalRefund > 0) {
      const { error: walletError } = await adminClient.rpc('credit_order_item_refund_to_wallet', {
        p_profile_id: order.placed_by_profile_id,
        p_reseller_id: order.reseller_id,
        p_amount: totalRefund,
        p_order_id: order_id,
        p_note: `Remboursement (annulation par le revendeur) — commande ${order_id}`,
      });
      if (walletError) {
        refundStatus = 'failed';
        refundError = walletError.message;
      }
    }

    await adminClient
      .from('order_items')
      .update({ refund_status: refundStatus, refund_method: 'wallet', refund_error: refundError ?? null })
      .in('id', targetIds);

    return json({
      success: true,
      order_id,
      order_status: cancelledOrderStatus,
      cancelled_item_count: targetIds.length,
      total_refund: totalRefund,
      refund_status: refundStatus,
      refund_error: refundError,
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Erreur inconnue' }, 500);
  }
});
