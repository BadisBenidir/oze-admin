// Edge Function : club-pass-prices (outil interne, clé de service uniquement)
//
// Hausse des prix publics du Club B2B sans toucher aux abonnés en cours :
// crée, sur le même produit Stripe, un nouveau prix mensuel pour chaque pass
// demandé (même devise, même fiscalité), marque ancien et nouveau prix avec
// metadata.club_plan, et renvoie leurs ids. Il faut ensuite passer les
// nouveaux ids dans STRIPE_PRICE_DROPS / STRIPE_PRICE_REVENDEUR et les anciens
// en tête de STRIPE_PRICE_DROPS_LEGACY / STRIPE_PRICE_REVENDEUR_LEGACY
// (voir _shared/clubPlans.ts) : les abonnements existants restent sur leur prix.
//
// Appel : POST { "prices": { "drops": 49.9, "revendeur": 79.9 } }
//         Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
// Déploiement : `supabase functions deploy club-pass-prices --no-verify-jwt`

import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@17.7.0?target=deno';
import { currentPriceId, type ClubPlan } from '../_shared/clubPlans.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const PLAN_NAME: Record<ClubPlan, string> = { drops: 'Pass Drops', revendeur: 'Pass Revendeur' };

Deno.serve(async (req: Request) => {
  // Clé de service uniquement : seule une clé de service peut lister les comptes.
  const bearer = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!bearer) return json({ error: 'Non autorisé' }, 401);
  const probe = createClient(Deno.env.get('SUPABASE_URL')!, bearer, { auth: { persistSession: false } });
  const { error: authError } = await probe.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (authError) return json({ error: 'Non autorisé' }, 401);
  const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (!stripeSecretKey) return json({ error: 'Configuration serveur manquante' }, 500);
  const stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-06-20' });

  const { prices } = (await req.json()) as { prices?: Partial<Record<ClubPlan, number>> };
  const results = [];
  for (const plan of ['drops', 'revendeur'] as ClubPlan[]) {
    const amount = prices?.[plan];
    if (amount === undefined) continue;
    const cents = Math.round(Number(amount) * 100);
    if (!cents || cents <= 0) return json({ error: `Prix invalide pour ${plan}` }, 400);
    const oldId = currentPriceId(plan);
    if (!oldId) return json({ error: `Prix actuel introuvable pour ${plan}` }, 500);

    const old = await stripe.prices.retrieve(oldId);
    if (old.unit_amount === cents) {
      results.push({ plan, unchanged: true, price_id: oldId });
      continue;
    }
    const product = typeof old.product === 'string' ? old.product : old.product.id;
    const created = await stripe.prices.create({
      product,
      currency: old.currency,
      unit_amount: cents,
      recurring: { interval: old.recurring?.interval || 'month', interval_count: old.recurring?.interval_count || 1 },
      ...(old.tax_behavior && old.tax_behavior !== 'unspecified' ? { tax_behavior: old.tax_behavior } : {}),
      nickname: `${PLAN_NAME[plan]} — ${(cents / 100).toFixed(2).replace('.', ',')} €`,
      metadata: { club_plan: plan },
    });
    await stripe.prices.update(oldId, { metadata: { ...old.metadata, club_plan: plan } });
    results.push({ plan, old_price_id: oldId, old_amount: (old.unit_amount ?? 0) / 100, new_price_id: created.id, new_amount: cents / 100 });
  }
  return json({ results });
});
