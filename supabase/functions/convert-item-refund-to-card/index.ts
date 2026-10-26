// Edge Function : convert-item-refund-to-card
//
// Article B2B annulé et remboursé en crédit portefeuille : rembourse finalement
// le membre par carte (Stripe) et retire ce crédit de son portefeuille.
//   - action "preview" : montant proposé (article + assurance + certificat
//     Entrupy recrédités à l'annulation) et solde du membre ;
//   - action "convert" (+ amount) : débite le portefeuille (refusé si le
//     crédit a déjà été dépensé, debit_wallet_for_card_refund 0224), puis
//     rembourse par Stripe — sur le paiement carte de la commande s'il existe,
//     sinon sur les recharges de portefeuille payées par carte, de la plus
//     récente à la plus ancienne. Si Stripe ne peut pas tout rembourser, le
//     reste est recrédité sur le portefeuille ;
//   - action "retry" : article annulé dont le remboursement a échoué —
//     rembourse par carte la part payée par carte, le reste (payé avec le
//     portefeuille) est recrédité sur le portefeuille.
// Réservé aux admins avec le droit « refunds ».
//
// Déploiement : `supabase functions deploy convert-item-refund-to-card`

import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@17.7.0?target=deno';
import { hasAdminAccess } from '../_shared/adminAccess.ts';
import { refundCardThenWallet } from '../_shared/cardRefund.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const round2 = (n: number) => Math.round(n * 100) / 100;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Non authentifié' }, 401);
    const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await callerClient.auth.getUser();
    if (!user) return json({ error: 'Non authentifié' }, 401);
    if (!(await hasAdminAccess(callerClient, user.id, 'refunds'))) return json({ error: 'Action réservée aux administrateurs' }, 403);

    const { action, order_item_id, amount } = await req.json();
    if (!order_item_id || !['preview', 'convert', 'retry'].includes(action)) return json({ error: 'Requête invalide' }, 400);

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: item } = await admin
      .from('order_items')
      .select('id, order_id, line_total, insured, insurance_cost, cancelled_at, refund_status, refund_method')
      .eq('id', order_item_id)
      .maybeSingle();
    if (!item) return json({ error: 'Article introuvable' }, 404);

    if (action === 'retry') {
      if (!item.cancelled_at || item.refund_status !== 'failed') return json({ error: "Seul un article annulé dont le remboursement a échoué peut être relancé" }, 400);
      const { data: o } = await admin
        .from('orders')
        .select('id, order_number, placed_by_profile_id, reseller_id, stripe_payment_intent_id, payment_status')
        .eq('id', item.order_id)
        .maybeSingle();
      if (!o?.placed_by_profile_id || o.payment_status !== 'paid') return json({ error: 'Commande non payée ou membre introuvable' }, 400);
      const retryAmount = round2(Number(item.line_total || 0) + (item.insured ? Number(item.insurance_cost || 0) : 0));
      let r: { status: 'succeeded' | 'failed'; method: string; refundId?: string; message?: string; cardAmount: number; walletAmount: number };
      if (o.stripe_payment_intent_id) {
        r = await refundCardThenWallet(admin, {
          paymentIntentId: o.stripe_payment_intent_id,
          amount: retryAmount,
          profileId: o.placed_by_profile_id,
          resellerId: o.reseller_id,
          orderId: o.id,
          orderLabel: `commande ${o.order_number}`,
          metadata: { type: 'b2b_item_refund_retry', order_item_id: item.id },
        });
      } else {
        const { error: walletError } = await admin.rpc('credit_order_item_refund_to_wallet', {
          p_profile_id: o.placed_by_profile_id,
          p_reseller_id: o.reseller_id,
          p_amount: retryAmount,
          p_order_id: o.id,
          p_note: `Remboursement (article annulé) — commande ${o.order_number}`,
        });
        r = walletError
          ? { status: 'failed', method: 'wallet', message: walletError.message, cardAmount: 0, walletAmount: 0 }
          : { status: 'succeeded', method: 'wallet', cardAmount: 0, walletAmount: retryAmount };
      }
      await admin
        .from('order_items')
        .update({ refund_status: r.status, refund_method: r.method, stripe_refund_id: r.refundId ?? null, refund_error: r.message ?? null })
        .eq('id', item.id);
      if (r.status === 'failed') return json({ error: r.message || 'Remboursement impossible' }, 400);
      return json({ success: true, refunded_amount: r.cardAmount, wallet_recredited: r.walletAmount });
    }
    if (!item.cancelled_at || item.refund_method !== 'wallet' || item.refund_status !== 'succeeded') {
      return json({ error: "Seul un article annulé et remboursé en crédit portefeuille peut être remboursé par carte" }, 400);
    }
    const { data: order } = await admin
      .from('orders')
      .select('id, order_number, placed_by_profile_id, reseller_id, stripe_payment_intent_id')
      .eq('id', item.order_id)
      .maybeSingle();
    if (!order?.placed_by_profile_id) return json({ error: 'Commande ou membre introuvable' }, 404);

    // Crédit accordé à l'annulation : article + assurance, plus le certificat
    // Entrupy recrédité au même moment (±10 min) sur cette commande.
    const cancelledAt = new Date(item.cancelled_at).getTime();
    const { data: refunds } = await admin
      .from('wallet_transactions')
      .select('amount, note, created_at')
      .eq('order_id', order.id)
      .eq('type', 'remboursement');
    const entrupy = (refunds || [])
      .filter((r) => /entrupy/i.test(r.note || '') && Math.abs(new Date(r.created_at).getTime() - cancelledAt) <= 10 * 60 * 1000)
      .reduce((sum, r) => sum + Number(r.amount || 0), 0);
    const suggested = round2(Number(item.line_total || 0) + (item.insured ? Number(item.insurance_cost || 0) : 0) + entrupy);

    const { data: profile } = await admin.from('profiles').select('wallet_balance').eq('id', order.placed_by_profile_id).maybeSingle();
    const balance = round2(Number(profile?.wallet_balance || 0));

    if (action === 'preview') return json({ suggested_amount: suggested, wallet_balance: balance, order_number: order.order_number });

    // ---- convert ----
    if (!stripeSecretKey) return json({ error: 'STRIPE_SECRET_KEY manquant côté serveur' }, 500);
    const target = round2(Number(amount));
    if (!target || target <= 0) return json({ error: 'Montant invalide' }, 400);
    if (target > balance) return json({ error: `Solde insuffisant : le membre n'a plus que ${balance.toFixed(2)} € sur son portefeuille` }, 400);

    const note = `Remboursement par carte (au lieu du crédit) — article annulé, commande ${order.order_number}`;
    const { error: debitError } = await admin.rpc('debit_wallet_for_card_refund', {
      p_profile_id: order.placed_by_profile_id,
      p_reseller_id: order.reseller_id,
      p_amount: target,
      p_order_id: order.id,
      p_note: note,
    });
    if (debitError) return json({ error: debitError.message }, 400);

    const stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-06-20' });
    let remainingCents = Math.round(target * 100);
    const refundIds: string[] = [];
    let stripeError: string | null = null;

    // Paiements carte à rembourser : la commande elle-même, sinon les recharges.
    const paymentIntents: string[] = [];
    if (order.stripe_payment_intent_id) paymentIntents.push(order.stripe_payment_intent_id);
    const { data: topups } = await admin
      .from('wallet_transactions')
      .select('stripe_session_id')
      .eq('profile_id', order.placed_by_profile_id)
      .eq('type', 'rechargement')
      .eq('status', 'success')
      .not('stripe_session_id', 'is', null)
      .order('created_at', { ascending: false });
    for (const t of topups || []) {
      try {
        const session = await stripe.checkout.sessions.retrieve(t.stripe_session_id as string);
        const pi = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
        if (pi && !paymentIntents.includes(pi)) paymentIntents.push(pi);
      } catch {
        /* session illisible : ignorée */
      }
    }

    for (const pi of paymentIntents) {
      if (remainingCents <= 0) break;
      try {
        const intent = await stripe.paymentIntents.retrieve(pi, { expand: ['latest_charge'] });
        const charge = intent.latest_charge && typeof intent.latest_charge === 'object' ? intent.latest_charge : null;
        if (!charge || intent.status !== 'succeeded') continue;
        const refundable = (charge.amount_captured ?? charge.amount) - (charge.amount_refunded ?? 0);
        if (refundable <= 0) continue;
        const part = Math.min(refundable, remainingCents);
        const refund = await stripe.refunds.create({
          payment_intent: pi,
          amount: part,
          metadata: { type: 'b2b_item_refund_to_card', order_item_id: item.id, order_id: order.id },
        });
        refundIds.push(refund.id);
        remainingCents -= part;
      } catch (err) {
        stripeError = err instanceof Error ? err.message : 'Erreur Stripe inconnue';
      }
    }

    // Ce que Stripe n'a pas pu rembourser revient sur le portefeuille.
    const refundedAmount = round2(target - remainingCents / 100);
    if (remainingCents > 0) {
      await admin.rpc('credit_order_item_refund_to_wallet', {
        p_profile_id: order.placed_by_profile_id,
        p_reseller_id: order.reseller_id,
        p_amount: remainingCents / 100,
        p_order_id: order.id,
        p_note: `Remboursement par carte impossible pour ${(remainingCents / 100).toFixed(2)} € — recrédité, commande ${order.order_number}`,
      });
    }

    if (refundIds.length > 0) {
      await admin
        .from('order_items')
        .update({
          refund_method: remainingCents > 0 ? 'wallet' : 'stripe',
          stripe_refund_id: refundIds.join(','),
          refund_error: remainingCents > 0 ? `Remboursé ${refundedAmount.toFixed(2)} € par carte, le reste en crédit portefeuille` : null,
        })
        .eq('id', item.id);
    }

    if (refundedAmount <= 0) {
      return json({ error: `Aucun paiement carte remboursable trouvé${stripeError ? ` (${stripeError})` : ''} : le crédit a été remis sur le portefeuille.` }, 400);
    }
    return json({ success: true, refunded_amount: refundedAmount, wallet_recredited: round2(remainingCents / 100), refund_ids: refundIds });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Erreur inconnue' }, 500);
  }
});
