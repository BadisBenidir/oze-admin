// Edge Function : apply-community-prices
//
// Applique aux membres DÉJÀ abonnés (0214) les changements de prix de leur
// groupe programmés par l'admin (community_group_prices, 0212) : une fois la
// date d'application passée, le prix de leur abonnement Stripe est modifié
// sans prorata — la prochaine échéance est prélevée au nouveau prix.
//
// Membres passés au Pass Drops (0216) : jamais touchés.
// Prix cible d'un abonné = prix en vigueur de son groupe ; pour un
// réabonnement (metadata.resubscribe), jamais moins que le prix public des
// nouveaux membres (groupe 4). Seul un changement entré en vigueur APRÈS le
// début de l'abonnement est appliqué (un membre qui a souscrit d'avance au
// prix annoncé n'est jamais ramené à l'ancien prix). Un prix cible à 0 € n'est
// pas appliqué (à traiter à la main).
//
// Idempotent : n'agit que si le prix Stripe diffère du prix cible. Appelée
// chaque jour par pg_cron (0215).
//
// Déploiement : `supabase functions deploy apply-community-prices --no-verify-jwt`

import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@17.7.0?target=deno';

const LOG_PREFIX = '[apply-community-prices]';
const ONGOING_STATUSES = ['active', 'trialing', 'past_due'];
const PUBLIC_GROUP = 4;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

interface PriceRow { reseller_id: string; member_group: number; monthly_price: number; effective_from: string }

Deno.serve(async () => {
  const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (!stripeSecretKey) return json({ error: 'Configuration serveur manquante' }, 500);
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-06-20' });
  const today = new Date().toISOString().slice(0, 10);

  const { data: members, error } = await admin
    .from('reseller_contacts')
    .select('id, reseller_id, member_group, community_sub_plan, community_sub_pending_plan, community_sub_stripe_subscription_id')
    .in('community_sub_status', ONGOING_STATUSES)
    .not('community_sub_stripe_subscription_id', 'is', null);
  if (error) return json({ error: error.message }, 500);
  if (!members?.length) return json({ checked: 0, updated: 0 });

  const resellerIds = [...new Set(members.map((m) => m.reseller_id))];
  const { data: prices } = await admin
    .from('community_group_prices')
    .select('reseller_id, member_group, monthly_price, effective_from')
    .in('reseller_id', resellerIds)
    .lte('effective_from', today)
    .order('effective_from', { ascending: true });
  // Prix en vigueur par entreprise et par groupe (dernière ligne passée).
  const current = new Map<string, PriceRow>();
  for (const p of (prices || []) as PriceRow[]) current.set(`${p.reseller_id}:${p.member_group}`, { ...p, monthly_price: Number(p.monthly_price) });

  const results: { contact_id: string; from: number; to: number }[] = [];
  const errors: { contact_id: string; error: string }[] = [];

  for (const m of members) {
    try {
      // Membre passé (ou passant) au Pass Drops : son prix est celui du Pass Drops.
      if (!m.member_group || m.community_sub_plan === 'drops' || m.community_sub_pending_plan) continue;
      const sub = await stripe.subscriptions.retrieve(m.community_sub_stripe_subscription_id!);
      if (!ONGOING_STATUSES.includes(sub.status) || sub.schedule) continue;
      const item = sub.items.data[0];
      if (!item?.price) continue;
      const startedOn = new Date(sub.start_date * 1000).toISOString().slice(0, 10);

      const candidates = [current.get(`${m.reseller_id}:${m.member_group}`)];
      if (sub.metadata?.resubscribe === 'true' && m.member_group !== PUBLIC_GROUP) {
        candidates.push(current.get(`${m.reseller_id}:${PUBLIC_GROUP}`));
      }
      const valid = candidates.filter((c): c is PriceRow => Boolean(c));
      if (!valid.length) continue;
      // Rien de nouveau depuis la souscription : le prix payé reste celui choisi.
      if (!valid.some((c) => c.effective_from > startedOn)) continue;

      const target = Math.max(...valid.map((c) => c.monthly_price));
      const targetCents = Math.round(target * 100);
      if (targetCents <= 0 || targetCents === item.price.unit_amount) continue;

      const product = typeof item.price.product === 'string' ? item.price.product : item.price.product.id;
      await stripe.subscriptions.update(sub.id, {
        items: [{
          id: item.id,
          price_data: { currency: item.price.currency, unit_amount: targetCents, recurring: { interval: 'month' }, product },
        }],
        proration_behavior: 'none',
        metadata: { ...sub.metadata, monthly_price: target.toFixed(2) },
      });
      await admin.from('reseller_contacts').update({ community_sub_price: target }).eq('id', m.id);
      results.push({ contact_id: m.id, from: (item.price.unit_amount ?? 0) / 100, to: target });
      console.log(`${LOG_PREFIX} Membre ${m.id} : ${(item.price.unit_amount ?? 0) / 100} € → ${target} € à la prochaine échéance`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ contact_id: m.id, error: message });
      console.error(`${LOG_PREFIX} Membre ${m.id} : ${message}`);
    }
  }

  return json({ checked: members.length, updated: results.length, results, errors });
});
