// Edge Function : release-pending-wallet-debits
//
// Paiement mixte (solde + carte, panier B2B ou lot d'enchère) : le solde est
// débité « en attente » dès l'ouverture de la session Stripe, puis
// définitivement consommé si la carte paie, ou recrédité quand la session
// expire (webhook checkout.session.expired). Un revendeur qui revient en
// arrière depuis Stripe voyait donc son solde bloqué jusqu'à l'expiration.
//
// Ici, pour le revendeur connecté uniquement : chaque débit encore en
// attente dont la session Stripe n'est pas payée est libéré tout de suite —
// la session encore ouverte est d'abord expirée (elle ne peut alors plus
// être payée, donc aucun risque de double usage du solde), puis le solde
// est recrédité (refund_pending_wallet_debit, idempotente : le webhook
// d'expiration qui suit ne recrédite rien une seconde fois).
//
// Appelée au retour « paiement annulé » et depuis « Mon Portefeuille ».
// Mode admin ({ all: true }, rôle admin uniquement) : traite les débits en
// attente de TOUS les revendeurs — rattrapage des réservations restées
// bloquées quand l'événement checkout.session.expired n'était pas reçu.
// Secrets : STRIPE_SECRET_KEY
// Déploiement : `supabase functions deploy release-pending-wallet-debits`

import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@17.7.0?target=deno';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

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
    let allUsers = false;
    try {
      allUsers = (await req.json())?.all === true;
    } catch {
      // corps vide : mode revendeur
    }
    if (allUsers) {
      const { data: me } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle();
      if (me?.role !== 'admin') return reply({ error: 'Accès refusé' }, 403);
    }
    let query = admin
      .from('wallet_transactions')
      .select('id, amount, stripe_session_id')
      .eq('status', 'pending')
      .not('stripe_session_id', 'is', null);
    if (!allUsers) query = query.eq('profile_id', user.id);
    const { data: pending, error } = await query;
    if (error) return reply({ error: error.message }, 500);

    const stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-06-20' });
    let released = 0;
    let stillProcessing = 0;

    for (const tx of pending || []) {
      const sessionId = tx.stripe_session_id as string;
      let session: Stripe.Checkout.Session;
      try {
        session = await stripe.checkout.sessions.retrieve(sessionId);
      } catch (err) {
        console.warn('[release-pending-wallet-debits] session introuvable', sessionId, err instanceof Error ? err.message : err);
        continue;
      }
      // Payée (ou paiement en cours de validation) : le webhook finalise, on n'y touche pas.
      if (session.status === 'complete') {
        stillProcessing += 1;
        continue;
      }
      if (session.status === 'open') {
        try {
          await stripe.checkout.sessions.expire(sessionId);
        } catch (err) {
          // Payée entre-temps : on ne recrédite surtout pas.
          console.warn('[release-pending-wallet-debits] expiration impossible', sessionId, err instanceof Error ? err.message : err);
          stillProcessing += 1;
          continue;
        }
      }
      const { data: refund, error: refundError } = await admin.rpc('refund_pending_wallet_debit', { p_stripe_session_id: sessionId });
      if (refundError) {
        console.error('[release-pending-wallet-debits] remboursement', sessionId, refundError.message);
        continue;
      }
      if (refund?.found) released += Number(refund.amount) || 0;
    }

    return reply({ released: Math.round(released * 100) / 100, still_processing: stillProcessing, checked: (pending || []).length });
  } catch (err) {
    return reply({ error: err instanceof Error ? err.message : 'Erreur inconnue' }, 500);
  }
});
