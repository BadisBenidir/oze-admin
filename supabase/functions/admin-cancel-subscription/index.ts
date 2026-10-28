// Edge Function : admin-cancel-subscription
//
// Résiliation IMMÉDIATE d'un abonnement par l'admin (0237), remboursée au
// prorata du temps non utilisé de la période en cours.
//   - body { contactId, action: 'preview' | 'confirm' } :
//       abonné Club (compte 'subscriber') : resellers.stripe_subscription_id ;
//       membre de communauté : reseller_contacts.community_sub_stripe_subscription_id ;
//   - preview : montant remboursé, période, jours utilisés ;
//   - confirm : accès retiré (access_revoked_at, posé AVANT la résiliation
//     Stripe pour que le webhook ne suspende pas le compte Club), abonnement
//     Stripe résilié sans prorata Stripe, remboursement sur la carte du
//     dernier paiement, ligne négative dans le CA des abonnements.
// Le membre garde son espace en consultation (commandes, factures,
// portefeuille) : catalogue, drops, enchères et sourcing lui sont fermés.
//
// Secrets : STRIPE_SECRET_KEY
// Déploiement : `supabase functions deploy admin-cancel-subscription`

import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@17.7.0?target=deno';
import { hasAdminAccess } from '../_shared/adminAccess.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const DAY = 86400;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return reply({ error: 'Non authentifié' }, 401);
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeSecretKey) return reply({ error: 'Configuration serveur manquante' }, 500);

    const caller = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return reply({ error: 'Non authentifié' }, 401);
    const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    if (!(await hasAdminAccess(admin, user.id, 'refunds'))) return reply({ error: 'Accès refusé' }, 403);

    const { contactId, action } = await req.json();
    if (!contactId || !['preview', 'confirm'].includes(action)) return reply({ error: 'Requête invalide' }, 400);

    const { data: contact } = await admin
      .from('reseller_contacts')
      .select('id, reseller_id, profile_id, is_primary, community_sub_stripe_subscription_id, community_sub_plan, access_revoked_at, resellers(account_type, stripe_subscription_id, subscription_plan)')
      .eq('id', contactId)
      .maybeSingle();
    if (!contact) return reply({ error: 'Membre introuvable' }, 404);
    const reseller = (Array.isArray(contact.resellers) ? contact.resellers[0] : contact.resellers) as
      { account_type: string | null; stripe_subscription_id: string | null; subscription_plan: string | null } | null;
    const club = reseller?.account_type === 'subscriber';
    const subscriptionId = club ? reseller?.stripe_subscription_id : contact.community_sub_stripe_subscription_id;
    if (!subscriptionId) return reply({ error: 'Aucun abonnement Stripe pour ce membre' }, 400);

    const stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-06-20' });
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const ongoing = ['active', 'trialing', 'past_due', 'unpaid', 'incomplete'].includes(subscription.status);

    // Dernière facture payée : période couverte et paiement à rembourser.
    const { data: invoices } = await stripe.invoices.list({ subscription: subscriptionId, status: 'paid', limit: 1 });
    const invoice = invoices[0];
    const line = invoice?.lines?.data?.find((l: Stripe.InvoiceLineItem) => l.period) || invoice?.lines?.data?.[0];
    const periodStart = line?.period?.start ?? null;
    const periodEnd = line?.period?.end ?? null;
    const now = Math.floor(Date.now() / 1000);
    const chargeId = typeof invoice?.charge === 'string' ? invoice.charge : invoice?.charge?.id ?? null;
    let alreadyRefunded = 0;
    if (chargeId) alreadyRefunded = (await stripe.charges.retrieve(chargeId)).amount_refunded || 0;

    let refundCents = 0;
    if (invoice && chargeId && periodStart && periodEnd && periodEnd > now && invoice.amount_paid > 0) {
      const unused = Math.min(1, (periodEnd - Math.max(now, periodStart)) / (periodEnd - periodStart));
      refundCents = Math.max(0, Math.min(Math.floor(invoice.amount_paid * unused), invoice.amount_paid - alreadyRefunded));
    }
    const summary = {
      club,
      subscription_status: subscription.status,
      amount_paid: invoice ? invoice.amount_paid / 100 : 0,
      period_start: periodStart ? new Date(periodStart * 1000).toISOString() : null,
      period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      days_used: periodStart ? Math.max(0, Math.ceil((Math.min(now, periodEnd ?? now) - periodStart) / DAY)) : null,
      days_total: periodStart && periodEnd ? Math.round((periodEnd - periodStart) / DAY) : null,
      refund: refundCents / 100,
      already_revoked: Boolean(contact.access_revoked_at),
    };
    if (action === 'preview') return reply(summary);

    // 1. Accès retiré (avant Stripe : le webhook de fin d'abonnement le voit).
    const revokedAt = new Date().toISOString();
    const revokeQuery = admin.from('reseller_contacts').update({ access_revoked_at: revokedAt });
    const { error: revokeError } = club ? await revokeQuery.eq('reseller_id', contact.reseller_id) : await revokeQuery.eq('id', contact.id);
    if (revokeError) return reply({ error: revokeError.message }, 500);

    // 2. Résiliation Stripe immédiate, sans prorata Stripe (remboursé ci-dessous).
    if (ongoing) {
      try {
        await stripe.subscriptions.cancel(subscriptionId, { prorate: false, invoice_now: false });
      } catch (err) {
        const rollback = admin.from('reseller_contacts').update({ access_revoked_at: contact.access_revoked_at ?? null });
        await (club ? rollback.eq('reseller_id', contact.reseller_id) : rollback.eq('id', contact.id));
        return reply({ error: `Résiliation Stripe impossible : ${err instanceof Error ? err.message : err}` }, 502);
      }
    }
    if (club) {
      await admin.from('resellers').update({ subscription_status: 'canceled', subscription_cancel_at_period_end: false }).eq('id', contact.reseller_id);
    } else {
      await admin.from('reseller_contacts').update({ community_sub_status: 'canceled', community_sub_pending_plan: null }).eq('id', contact.id);
    }

    // 3. Remboursement au prorata, déduit du CA des abonnements.
    let refundId: string | null = null;
    let refundError: string | null = null;
    if (refundCents > 0 && chargeId) {
      try {
        const refund = await stripe.refunds.create(
          { charge: chargeId, amount: refundCents, metadata: { reason: 'admin_cancel_subscription', contact_id: contact.id, subscription_id: subscriptionId } },
          { idempotencyKey: `admin-cancel-${subscriptionId}` },
        );
        refundId = refund.id;
        const row = {
          stripe_invoice_id: `refund-${refund.id}`,
          stripe_subscription_id: subscriptionId,
          stripe_customer_id: typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id ?? null,
          reseller_id: contact.reseller_id,
          amount: -refundCents / 100,
          currency: invoice.currency || 'eur',
          billing_reason: 'admin_refund',
          paid_at: revokedAt,
        };
        const { error: rowError } = club
          ? await admin.from('b2b_subscription_payments').upsert({ ...row, plan: reseller?.subscription_plan ?? null }, { onConflict: 'stripe_invoice_id' })
          : await admin.from('community_subscription_payments').upsert(
            { ...row, contact_id: contact.id, profile_id: contact.profile_id, plan: contact.community_sub_plan ?? null },
            { onConflict: 'stripe_invoice_id' },
          );
        if (rowError) console.error('[admin-cancel-subscription] CA :', rowError.message);
      } catch (err) {
        refundError = err instanceof Error ? err.message : String(err);
      }
    }

    return reply({ ...summary, success: true, refund_id: refundId, refund_error: refundError });
  } catch (err) {
    console.error('[admin-cancel-subscription]', err);
    return reply({ error: err instanceof Error ? err.message : 'Erreur inattendue' }, 500);
  }
});
