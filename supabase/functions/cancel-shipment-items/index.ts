// Edge Function : cancel-shipment-items
//
// Annule un ou plusieurs articles d'une demande de livraison pas encore
// étiquetés (cas typique : article jamais reçu à l'atelier) — RÉSERVÉ AUX
// ADMINS OZË (profiles.role='admin'). En un seul appel :
//   1. annule chaque article (cancel_b2b_order_item, 0146 : recalcul de la
//      commande, produit remis au statut choisi) et rembourse son prix
//      (article + assurance) en crédit solde ou via Stripe ;
//   2. détache les articles de la demande (0161) — demande passée en
//      'cancelled' s'il n'y reste plus rien ;
//   3. rembourse (ou non) tout ou partie des frais de port de la demande.
//
// Toutes les vérifications sont faites AVANT la première écriture : un choix
// impossible (Stripe sur une commande payée au solde, lot d'enchère...)
// n'annule rien. Un échec de remboursement, lui, n'annule pas l'annulation
// déjà actée : il est enregistré (refund_status='failed') pour traitement
// manuel, exactement comme cancel-b2b-order-item.
//
// Déploiement : `supabase functions deploy cancel-shipment-items`

import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@17.7.0?target=deno';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

type ItemRow = {
  id: string;
  status: string;
  shipment_id: string | null;
  fulfillment_status: string;
  order: { id: string; payment_status: string; stripe_payment_intent_id: string | null } | null;
};

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

    const { shipment_id, item_ids, reason, restock_action, item_refund_method, shipping_refund_method, shipping_refund_amount } = await req.json();
    if (!shipment_id || !Array.isArray(item_ids) || item_ids.length === 0 || !reason || !restock_action) {
      return json({ error: 'shipment_id, item_ids, reason et restock_action sont requis' }, 400);
    }
    if (!['draft', 'for-sale-b2b', 'archived'].includes(restock_action)) return json({ error: 'restock_action invalide' }, 400);
    if (!['wallet', 'stripe'].includes(item_refund_method)) return json({ error: 'item_refund_method invalide' }, 400);
    if (!['wallet', 'stripe', 'none'].includes(shipping_refund_method)) return json({ error: 'shipping_refund_method invalide' }, 400);
    const shippingAmount = shipping_refund_method === 'none' ? 0 : Number(shipping_refund_amount);

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // ---- Vérifications (aucune écriture avant la fin de ce bloc) ----------
    const { data: shipment } = await adminClient
      .from('shipments')
      .select('id, shipping_cost, stripe_session_id, status')
      .eq('id', shipment_id)
      .maybeSingle();
    if (!shipment) return json({ error: 'Demande de livraison introuvable' }, 404);
    if (shipping_refund_method !== 'none') {
      if (!(shippingAmount > 0) || shippingAmount > Number(shipment.shipping_cost || 0)) {
        return json({ error: `Montant des frais de port à rembourser invalide (max ${Number(shipment.shipping_cost || 0).toFixed(2)} €)` }, 400);
      }
      if (shipping_refund_method === 'stripe' && !shipment.stripe_session_id) {
        return json({ error: 'Aucun paiement Stripe de frais de port sur cette demande — choisissez le crédit' }, 400);
      }
    }

    const { data: itemRows, error: itemsError } = await adminClient
      .from('order_items')
      .select('id, status, shipment_id, fulfillment_status, order:orders(id, payment_status, stripe_payment_intent_id)')
      .in('id', item_ids);
    if (itemsError) return json({ error: itemsError.message }, 500);
    const items = (itemRows || []) as unknown as ItemRow[];
    const invalid = item_ids.filter((id: string) => {
      const it = items.find((i) => i.id === id);
      return !it || it.shipment_id !== shipment_id || it.status !== 'active' || it.fulfillment_status !== 'delivery_requested';
    });
    if (invalid.length > 0) {
      return json({ error: "Certains articles ne sont plus annulables ici (déjà étiquetés, annulés ou hors de cette demande) — rechargez la page." }, 409);
    }

    const orderIds = [...new Set(items.map((i) => i.order?.id).filter(Boolean))] as string[];
    const { data: auctionRows } = await adminClient.from('auction_items').select('order_id').in('order_id', orderIds);
    if ((auctionRows || []).length > 0) {
      return json({ error: "Un des articles est un lot remporté aux enchères — annulez-le depuis Enchères B2B." }, 400);
    }
    if (item_refund_method === 'stripe') {
      const walletOnly = items.filter((i) => i.order?.payment_status === 'paid' && !i.order?.stripe_payment_intent_id);
      if (walletOnly.length > 0) {
        return json({ error: 'Un des articles a été payé avec le solde — remboursement Stripe impossible, choisissez le crédit.' }, 400);
      }
    }

    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');
    const stripe = stripeSecretKey ? new Stripe(stripeSecretKey, { apiVersion: '2024-06-20' }) : null;

    // ---- 1. Annulation + remboursement de chaque article ------------------
    const itemResults: Array<{ id: string; refund_status: string; refunded: number; error?: string }> = [];
    let itemsRefunded = 0;

    for (const itemId of item_ids as string[]) {
      const { data: result, error: rpcError } = await adminClient.rpc('cancel_b2b_order_item', {
        p_order_item_id: itemId,
        p_reason: reason,
        p_restock_action: restock_action,
      });
      if (rpcError) {
        itemResults.push({ id: itemId, refund_status: 'failed', refunded: 0, error: `Annulation : ${rpcError.message}` });
        continue;
      }

      if (result?.payment_status !== 'paid') {
        await adminClient.from('order_items').update({ refund_status: 'not_applicable' }).eq('id', itemId);
        itemResults.push({ id: itemId, refund_status: 'not_applicable', refunded: 0 });
        continue;
      }

      const amount = Number(result.refund_amount) || 0;
      let refundError: string | undefined;
      let refundId: string | undefined;
      if (item_refund_method === 'stripe') {
        if (!stripe) refundError = 'STRIPE_SECRET_KEY manquant côté serveur';
        else {
          try {
            const refund = await stripe.refunds.create({ payment_intent: result.stripe_payment_intent_id, amount: Math.round(amount * 100) });
            refundId = refund.id;
          } catch (err) {
            refundError = err instanceof Error ? err.message : 'Erreur Stripe inconnue';
          }
        }
      } else {
        const { error: walletError } = await adminClient.rpc('credit_order_item_refund_to_wallet', {
          p_profile_id: result.placed_by_profile_id,
          p_reseller_id: result.reseller_id,
          p_amount: amount,
          p_order_id: result.order_id,
          p_note: `Remboursement (article non reçu, annulé) — commande ${result.order_id}`,
        });
        if (walletError) refundError = walletError.message;
      }

      const status = refundError ? 'failed' : 'succeeded';
      await adminClient
        .from('order_items')
        .update({ refund_status: status, refund_method: item_refund_method, stripe_refund_id: refundId ?? null, refund_error: refundError ?? null })
        .eq('id', itemId);
      if (!refundError) itemsRefunded += amount;
      itemResults.push({ id: itemId, refund_status: status, refunded: refundError ? 0 : amount, error: refundError });
    }

    const cancelledIds = itemResults.filter((r) => !r.error?.startsWith('Annulation')).map((r) => r.id);
    if (cancelledIds.length === 0) {
      return json({ error: itemResults.map((r) => r.error).join(' · ') || 'Aucun article annulé' }, 400);
    }

    // ---- 2. Détache les articles de la demande ---------------------------
    const { data: detach, error: detachError } = await adminClient.rpc('admin_detach_cancelled_items_from_shipment_core', {
      p_shipment_id: shipment_id,
      p_item_ids: cancelledIds,
      p_reason: reason,
      p_shipping_refund_method: shipping_refund_method,
      p_shipping_refund_amount: shippingAmount,
    });
    if (detachError) {
      return json({ error: `Articles annulés et remboursés, mais échec de la mise à jour de la demande : ${detachError.message}`, items: itemResults }, 500);
    }

    // ---- 3. Frais de port ------------------------------------------------
    let shippingError: string | null = null;
    if (shipping_refund_method === 'stripe') {
      if (!stripe) shippingError = 'STRIPE_SECRET_KEY manquant côté serveur';
      else {
        try {
          const session = await stripe.checkout.sessions.retrieve(shipment.stripe_session_id);
          const pi = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
          if (!pi) shippingError = 'Paiement Stripe des frais de port introuvable';
          else await stripe.refunds.create({ payment_intent: pi, amount: Math.round(shippingAmount * 100) });
        } catch (err) {
          shippingError = `Stripe : ${err instanceof Error ? err.message : 'erreur inconnue'}`;
        }
      }
    } else if (shipping_refund_method === 'wallet') {
      const { error: walletError } = await adminClient.rpc('credit_order_item_refund_to_wallet', {
        p_profile_id: detach.profile_id,
        p_reseller_id: detach.reseller_id,
        p_amount: shippingAmount,
        p_order_id: null,
        p_note: `Remboursement frais de port (article(s) annulé(s)) — demande ${shipment_id}`,
      });
      if (walletError) shippingError = `Crédit solde : ${walletError.message}`;
    }
    if (shipping_refund_method !== 'none') {
      await adminClient
        .from('shipments')
        .update({ shipping_refund_status: shippingError ? 'failed' : 'succeeded', shipping_refund_error: shippingError })
        .eq('id', shipment_id);
    }

    const failures = [
      ...itemResults.filter((r) => r.error).map((r) => r.error as string),
      ...(shippingError ? [`Frais de port : ${shippingError}`] : []),
    ];

    return json({
      success: true,
      cancelled_count: cancelledIds.length,
      items_refunded: itemsRefunded,
      shipping_refunded: shippingError ? 0 : shippingAmount,
      shipment_status: detach?.shipment_status,
      failures: failures.length ? failures : undefined,
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Erreur inconnue' }, 500);
  }
});
