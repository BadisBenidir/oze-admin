// Edge Function : stripe-monthly-fees
//
// Comptabilité → Charges (0276), bouton « Frais Stripe » : additionne les frais
// Stripe d'un mois (balance_transactions : frais de paiement, frais de
// virement / payout, frais Stripe facturés à part) et enregistre la charge
// du mois (expenses.external_ref = 'stripe-fees-AAAA-MM', catégorie « Frais
// Stripe »). Rejouable : la charge du mois est mise à jour, jamais dupliquée.
//
// Ces frais sont déduits par Stripe avant chaque virement : ils
// n'apparaissent jamais comme débit sur Qonto.
//
// Réservé au propriétaire (comme la table expenses). Body : { month: 'AAAA-MM' }.
// Déploiement : `supabase functions deploy stripe-monthly-fees`
// Secrets : STRIPE_SECRET_KEY

import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@17.7.0?target=deno';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

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

    const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle();
    if (profile?.role !== 'admin') return json({ error: 'Réservé au propriétaire' }, 403);

    const { month } = await req.json();
    const m = typeof month === 'string' ? month.match(/^(\d{4})-(\d{2})$/) : null;
    if (!m) return json({ error: 'Mois attendu au format AAAA-MM' }, 400);
    const year = Number(m[1]);
    const monthIndex = Number(m[2]) - 1;
    if (monthIndex < 0 || monthIndex > 11) return json({ error: 'Mois invalide' }, 400);

    const start = Math.floor(Date.UTC(year, monthIndex, 1) / 1000);
    const end = Math.floor(Date.UTC(year, monthIndex + 1, 1) / 1000);
    const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).toISOString().slice(0, 10);

    const stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-06-20' });
    let feeCents = 0;
    let count = 0;
    for await (const tx of stripe.balanceTransactions.list({ created: { gte: start, lt: end }, limit: 100 })) {
      count += 1;
      // Frais attachés au mouvement (paiement, virement) ; les frais Stripe
      // facturés à part sont des mouvements « stripe_fee » de montant négatif.
      feeCents += tx.fee;
      if (tx.type === 'stripe_fee') feeCents += -tx.amount;
    }
    const amount = Math.round(feeCents) / 100;
    const ref = `stripe-fees-${month}`;
    const row = {
      label: `Frais Stripe – ${MONTHS[monthIndex]} ${year}`,
      category: 'Frais Stripe',
      amount,
      spent_at: lastDay,
      notes: `Frais de paiement + frais de virement (API Stripe, ${count} mouvements)`,
      external_ref: ref,
      review_status: 'validated',
    };

    const { data: existing } = await admin.from('expenses').select('id').eq('external_ref', ref).maybeSingle();
    const { error } = existing
      ? await admin.from('expenses').update(row).eq('id', existing.id)
      : await admin.from('expenses').insert(row);
    if (error) return json({ error: error.message }, 500);

    return json({ amount, count, updated: Boolean(existing) });
  } catch (e) {
    console.error('stripe-monthly-fees', e);
    return json({ error: e instanceof Error ? e.message : 'Erreur' }, 500);
  }
});
