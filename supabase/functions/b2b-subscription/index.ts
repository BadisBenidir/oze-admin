// Edge Function : b2b-subscription
//
// Gestion de son abonnement Club B2B par l'abonné lui-même (voir 0167) :
//   - action "upgrade" : Pass Drops → Pass Revendeur. Stripe facture
//     immédiatement la différence au prorata du mois en cours sur la carte
//     enregistrée (proration_behavior = always_invoice) ; si le paiement
//     échoue, rien ne change (payment_behavior = error_if_incomplete).
//   - action "cancel" : résiliation à la fin de la période déjà payée
//     (cancel_at_period_end) — l'accès est coupé par le webhook
//     (customer.subscription.deleted) à l'échéance.
//   - action "resume" : annule une résiliation programmée.
//   - action "checkout" (+ plan) : réabonnement d'un abonné résilié, ou
//     paiement jamais finalisé après l'inscription — renvoie l'URL d'une
//     session Stripe sur le même revendeur (tout son espace est conservé).
//   - action "invoices" : liste de toutes ses factures Stripe (une par mois,
//     plus les éventuelles différences au prorata), avec PDF et lien en ligne.
//   - action "portal" : portail client Stripe (changer de carte, régler une
//     échéance en échec). Le portail doit être activé une fois dans Stripe
//     (Paramètres → Billing → Portail client).
//   - action "downgrade" / "cancel_downgrade" : Pass Revendeur → Pass Drops
//     à la prochaine échéance (planning Stripe), ou annulation de ce passage.
//   - action "sync_billing" : reporte l'identité légale du profil (dénomination,
//     SIRET, TVA, siège) sur le client Stripe, donc sur les prochaines factures.
//
// La base est mise à jour tout de suite (réponse immédiate dans l'interface),
// puis confirmée par le webhook customer.subscription.updated.
//
// Secrets : STRIPE_SECRET_KEY, STRIPE_PRICE_DROPS, STRIPE_PRICE_REVENDEUR (ids "price_...")
// Déploiement : `supabase functions deploy b2b-subscription`

import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@17.7.0?target=deno';
import { createSubscriptionCheckout, isSubscriptionPlan, siteOrigin } from '../_shared/subscriptionCheckout.ts';
import { syncStripeBillingIdentity } from '../_shared/stripeBilling.ts';

/** Statuts Stripe d'un abonnement encore en cours (donc pas de réabonnement possible). */
const ONGOING_STATUSES = new Set(['active', 'trialing', 'past_due']);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const periodEnd = (subscription: Stripe.Subscription): string | null => {
  const raw =
    (subscription as unknown as { current_period_end?: number }).current_period_end ??
    (subscription.items.data[0] as unknown as { current_period_end?: number } | undefined)?.current_period_end;
  return raw ? new Date(raw * 1000).toISOString() : null;
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return reply({ error: 'Non authentifié' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeSecretKey) return reply({ error: 'Configuration serveur manquante' }, 500);

    const caller = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return reply({ error: 'Non authentifié' }, 401);

    const { action, plan } = await req.json();
    if (!['upgrade', 'downgrade', 'cancel_downgrade', 'cancel', 'resume', 'checkout', 'invoices', 'portal', 'sync_billing'].includes(action)) {
      return reply({ error: 'Action inconnue' }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: contact } = await admin
      .from('reseller_contacts')
      .select('reseller_id, resellers!inner(id, account_type, status, subscription_plan, subscription_status, stripe_subscription_id, stripe_customer_id)')
      .eq('profile_id', user.id)
      .maybeSingle();
    const reseller = contact && (Array.isArray(contact.resellers) ? contact.resellers[0] : contact.resellers);

    if (!reseller || reseller.account_type !== 'subscriber') {
      return reply({ error: 'Aucun abonnement associé à ce compte' }, 403);
    }

    const stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-06-20' });

    // Toutes les factures de l'abonné (un mois = une facture), y compris après
    // résiliation : consultables et téléchargeables depuis « Mon profil ».
    if (action === 'invoices') {
      if (!reseller.stripe_customer_id) return reply({ invoices: [] });
      const invoices = [];
      for await (const inv of stripe.invoices.list({ customer: reseller.stripe_customer_id, limit: 100 })) {
        if (inv.status === 'draft' || inv.status === 'void') continue;
        const line = inv.lines?.data?.[0];
        invoices.push({
          id: inv.id,
          number: inv.number,
          created: new Date(inv.created * 1000).toISOString(),
          period_start: line?.period?.start ? new Date(line.period.start * 1000).toISOString() : null,
          period_end: line?.period?.end ? new Date(line.period.end * 1000).toISOString() : null,
          amount: (inv.status === 'paid' ? inv.amount_paid : inv.amount_due) / 100,
          currency: inv.currency,
          status: inv.status,
          hosted_invoice_url: inv.hosted_invoice_url,
          invoice_pdf: inv.invoice_pdf,
        });
        if (invoices.length >= 120) break;
      }
      return reply({ invoices });
    }

    // Portail Stripe : changer de carte, régler une échéance en échec. Ouvert
    // aussi à un abonné suspendu pour impayé (c'est justement là qu'il en a besoin).
    if (action === 'portal') {
      if (!reseller.stripe_customer_id) return reply({ error: 'Aucun moyen de paiement enregistré pour ce compte' }, 400);
      const session = await stripe.billingPortal.sessions.create({
        customer: reseller.stripe_customer_id,
        return_url: `${siteOrigin(req)}/mon-profil`,
        locale: 'fr',
      });
      return reply({ url: session.url });
    }

    // Identité légale (dénomination, SIRET, TVA, siège) reportée sur les
    // factures Stripe, appelée après l'enregistrement du statut juridique.
    if (action === 'sync_billing') {
      if (!reseller.stripe_customer_id) return reply({ synced: false });
      const synced = await syncStripeBillingIdentity(stripe, admin, user.id, reseller.stripe_customer_id);
      return reply({ synced });
    }

    // Réabonnement (abonnement terminé) ou premier paiement jamais finalisé :
    // nouvelle session Stripe sur le MÊME revendeur, activé par le webhook.
    // Jamais pour une suspension décidée par l'admin (abonnement encore valide).
    if (action === 'checkout') {
      const subscriptionEnded = !reseller.subscription_status || !ONGOING_STATUSES.has(reseller.subscription_status);
      const canCheckout =
        reseller.status === 'pending' || (reseller.status === 'suspended' && subscriptionEnded);
      if (!canCheckout) return reply({ error: 'Votre abonnement est déjà actif' }, 400);
      if (!isSubscriptionPlan(plan)) return reply({ error: 'Pass inconnu' }, 400);

      // Paiement déjà passé mais webhook pas encore traité (connexion juste
      // après le paiement) : on n'ouvre surtout pas un second abonnement.
      try {
        const existing = await stripe.subscriptions.search({
          query: `metadata['reseller_id']:'${reseller.id}' AND status:'active'`,
          limit: 1,
        });
        if (existing.data.length > 0) {
          return reply({ error: 'Votre paiement est en cours de validation : votre espace s\'ouvrira dans un instant, rechargez la page.' }, 409);
        }
      } catch (err) {
        // Recherche Stripe indisponible : on n'empêche pas le réabonnement.
        console.warn('[b2b-subscription] recherche d\'abonnement impossible :', err instanceof Error ? err.message : err);
      }

      const origin = siteOrigin(req);
      const url = await createSubscriptionCheckout(stripe, {
        plan,
        resellerId: reseller.id,
        email: user.email!,
        customerId: reseller.stripe_customer_id,
        successUrl: `${origin}/catalogue?abonnement=ok`,
        cancelUrl: `${origin}/catalogue`,
      });
      return reply({ url });
    }

    if (!reseller.stripe_subscription_id) return reply({ error: 'Aucun abonnement associé à ce compte' }, 403);
    if (reseller.status !== 'active') return reply({ error: 'Votre abonnement n\'est plus actif' }, 403);
    let current = await stripe.subscriptions.retrieve(reseller.stripe_subscription_id);
    let updated: Stripe.Subscription;
    const scheduleId = typeof current.schedule === 'string' ? current.schedule : current.schedule?.id;

    // Passage au Pass Drops À L'ÉCHÉANCE : le mois déjà payé reste en Pass
    // Revendeur, le pass Drops s'applique au renouvellement (planning Stripe).
    // Le webhook customer.subscription.updated enregistre le nouveau pass le
    // jour venu et efface subscription_pending_plan.
    if (action === 'downgrade') {
      if (reseller.subscription_plan !== 'revendeur') return reply({ error: 'Vous avez déjà le Pass Drops' }, 400);
      if (current.cancel_at_period_end) return reply({ error: 'Votre abonnement est déjà résilié à l\'échéance' }, 400);
      const dropsPrice = Deno.env.get('STRIPE_PRICE_DROPS');
      if (!dropsPrice) return reply({ error: 'Configuration serveur manquante (prix Pass Drops)' }, 500);

      const { error: pendingError } = await admin.from('resellers').update({ subscription_pending_plan: 'drops' }).eq('id', reseller.id);
      if (pendingError) return reply({ error: pendingError.message }, 500);
      try {
        const schedule = scheduleId
          ? await stripe.subscriptionSchedules.retrieve(scheduleId)
          : await stripe.subscriptionSchedules.create({ from_subscription: current.id });
        const phase = schedule.phases[schedule.phases.length - 1];
        await stripe.subscriptionSchedules.update(schedule.id, {
          end_behavior: 'release',
          proration_behavior: 'none',
          phases: [
            {
              items: [{ price: current.items.data[0].price.id, quantity: 1 }],
              start_date: phase.start_date,
              end_date: phase.end_date,
            },
            { items: [{ price: dropsPrice, quantity: 1 }], iterations: 1 },
          ],
        });
      } catch (err) {
        await admin.from('resellers').update({ subscription_pending_plan: null }).eq('id', reseller.id);
        return reply({ error: `Changement de pass impossible : ${err instanceof Error ? err.message : 'erreur inconnue'}` }, 500);
      }
      return reply({ success: true, subscription_pending_plan: 'drops' });
    }

    // Toute autre action annule d'abord un passage au Pass Drops programmé
    // (un planning Stripe empêcherait de modifier l'abonnement directement).
    if (scheduleId) {
      await stripe.subscriptionSchedules.release(scheduleId);
      await admin.from('resellers').update({ subscription_pending_plan: null }).eq('id', reseller.id);
      current = await stripe.subscriptions.retrieve(current.id);
    }
    if (action === 'cancel_downgrade') {
      return reply({ success: true, subscription_pending_plan: null });
    }

    if (action === 'upgrade') {
      if (reseller.subscription_plan !== 'drops') return reply({ error: 'Vous avez déjà le Pass Revendeur' }, 400);
      const revendeurPrice = Deno.env.get('STRIPE_PRICE_REVENDEUR');
      if (!revendeurPrice) return reply({ error: 'Configuration serveur manquante (prix Pass Revendeur)' }, 500);
      try {
        updated = await stripe.subscriptions.update(current.id, {
          items: [{ id: current.items.data[0].id, price: revendeurPrice }],
          proration_behavior: 'always_invoice',
          payment_behavior: 'error_if_incomplete',
          // Passer au pass supérieur annule une éventuelle résiliation programmée.
          cancel_at_period_end: false,
        });
      } catch (err) {
        return reply({
          error: `Le paiement de la différence a échoué : ${err instanceof Error ? err.message : 'erreur inconnue'}. Vérifiez votre moyen de paiement.`,
        }, 402);
      }
    } else {
      updated = await stripe.subscriptions.update(current.id, { cancel_at_period_end: action === 'cancel' });
    }

    const columns = {
      subscription_plan: action === 'upgrade' ? 'revendeur' : reseller.subscription_plan,
      subscription_status: updated.status,
      subscription_current_period_end: periodEnd(updated),
      subscription_cancel_at_period_end: Boolean(updated.cancel_at_period_end),
    };
    const { error: updateError } = await admin.from('resellers').update(columns).eq('id', reseller.id);
    if (updateError) return reply({ error: updateError.message }, 500);

    return reply({ success: true, ...columns });
  } catch (err) {
    return reply({ error: err instanceof Error ? err.message : 'Erreur inconnue' }, 500);
  }
});
