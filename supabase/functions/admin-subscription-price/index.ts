// Edge Function : admin-subscription-price
//
// Prix mensuel d'un abonné Club fixé par l'admin (ex. un membre Vintelia
// Élite passé Premium qui garde 59,90 € au lieu de 79,90 €) :
//   - action "preview" (+ resellerId) : prix du pass, remise en cours et
//     montant du prochain prélèvement (facture à venir Stripe) ;
//   - action "set" (+ resellerId, price) : remplace les remises de
//     l'abonnement par un coupon Stripe « à vie » (prix du pass − prix voulu) ;
//     un prix ≥ prix du pass retire toute remise. Effet dès le prochain
//     prélèvement, aucune facturation immédiate.
// Réservé à l'équipe avec le droit « accounts ».
//
// Secrets : STRIPE_SECRET_KEY
// Déploiement : `supabase functions deploy admin-subscription-price`

import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@17.7.0?target=deno';
import { hasAdminAccess } from '../_shared/adminAccess.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const euros = (cents: number) => (cents / 100).toFixed(2).replace('.', ',');

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeSecretKey) return json({ error: 'STRIPE_SECRET_KEY manquant côté serveur' }, 500);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Non authentifié' }, 401);
    const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await callerClient.auth.getUser();
    if (!user) return json({ error: 'Non authentifié' }, 401);
    if (!(await hasAdminAccess(callerClient, user.id, 'accounts'))) return json({ error: 'Action réservée aux administrateurs' }, 403);

    const { action, resellerId, price } = await req.json();
    if (!resellerId || !['preview', 'set'].includes(action)) return json({ error: 'Requête invalide' }, 400);

    const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: reseller } = await admin.from('resellers').select('id, stripe_subscription_id').eq('id', resellerId).maybeSingle();
    if (!reseller?.stripe_subscription_id) return json({ error: 'Aucun abonnement Stripe pour cet abonné' }, 400);

    const stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-06-20' });
    const sub = await stripe.subscriptions.retrieve(reseller.stripe_subscription_id, { expand: ['discounts'] });
    if (!['active', 'trialing', 'past_due'].includes(sub.status)) return json({ error: "L'abonnement n'est plus en cours" }, 400);
    const unit = sub.items.data[0]?.price?.unit_amount ?? 0;

    if (action === 'preview') {
      let nextAmount: number | null = null;
      try {
        const upcoming = await stripe.invoices.retrieveUpcoming({ subscription: sub.id });
        nextAmount = upcoming.amount_due / 100;
      } catch {
        /* pas de facture à venir (résiliation programmée…) */
      }
      const discounts = ((sub.discounts || []) as (string | Stripe.Discount)[])
        .filter((d): d is Stripe.Discount => typeof d === 'object')
        .map((d) => d.coupon?.name || d.coupon?.id || 'Remise');
      return json({
        plan_price: unit / 100,
        next_amount: nextAmount,
        next_date: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
        discounts,
        cancel_at_period_end: sub.cancel_at_period_end,
      });
    }

    const target = Math.round(Number(price) * 100);
    if (!Number.isFinite(target) || target < 0) return json({ error: 'Prix invalide' }, 400);

    if (target >= unit) {
      await stripe.subscriptions.update(sub.id, { discounts: [] });
      return json({ success: true, price: unit / 100 });
    }

    const couponId = `admin_fp${target}_of${unit}_forever`;
    try {
      await stripe.coupons.retrieve(couponId);
    } catch {
      await stripe.coupons.create({
        id: couponId,
        name: `Prix fixé ${euros(target)} €`,
        amount_off: unit - target,
        currency: 'eur',
        duration: 'forever',
      });
    }
    await stripe.subscriptions.update(sub.id, { discounts: [{ coupon: couponId }] });
    return json({ success: true, price: target / 100 });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Erreur inconnue' }, 500);
  }
});
