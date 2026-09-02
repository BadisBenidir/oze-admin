// Edge Function : b2b-request-entrupy-certificate
//
// Crée une session de paiement Stripe pour ajouter le certificat
// d'authenticité Entrupy (19,99 €/pièce) à un ou plusieurs articles d'une
// commande B2B DÉJÀ PAYÉE. Ne modifie AUCUN order_item ici — ça n'arrive
// qu'après paiement confirmé, via b2b-stripe-webhook (branche
// metadata.type === 'entrupy_certificate_request') qui appelle
// finalize_entrupy_certificate_request. Même architecture que
// b2b-request-delivery-checkout / b2b-stripe-webhook.
//
// Paiement par carte uniquement (pas de solde B2B pour cet ajout ponctuel).
// Déploiement : `supabase functions deploy b2b-request-entrupy-certificate`

import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@17.7.0?target=deno';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

// Doit rester alignée avec la constante v_price de
// finalize_entrupy_certificate_request (0083_entrupy_certificate.sql) — le
// prix facturé ici n'est qu'un affichage Stripe, jamais accepté tel quel par
// la RPC qui, elle, refixe 19,99 € en autorité à la finalisation.
const ENTRUPY_CERTIFICATE_PRICE = 19.99;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeSecretKey) return json({ error: 'STRIPE_SECRET_KEY manquant dans les secrets Supabase' }, 500);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Non authentifié' }, 401);

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await callerClient.auth.getUser();
    if (userError || !user) return json({ error: 'Non authentifié' }, 401);

    const { data: resellerId } = await callerClient.rpc('current_reseller_id');
    if (!resellerId) return json({ error: 'Aucun compte revendeur actif associé à cet utilisateur' }, 403);

    const { item_ids } = await req.json();
    if (!Array.isArray(item_ids) || item_ids.length === 0) {
      return json({ error: 'Aucun article sélectionné' }, 400);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Même règle que order_items_reseller_select_own / b2b-request-delivery-
    // checkout : ses propres commandes toujours, celles de toute l'entreprise
    // seulement s'il est le contact principal — jamais accepté du client,
    // revalidé ici en autorité (adminClient = service_role, contourne RLS).
    // finalize_entrupy_certificate_request revalidera à nouveau l'éligibilité
    // au moment du paiement confirmé — cette étape ne sert qu'à afficher un
    // montant Stripe correct et un message d'erreur utile avant paiement.
    const { data: contact } = await adminClient
      .from('reseller_contacts')
      .select('is_primary')
      .eq('profile_id', user.id)
      .eq('reseller_id', resellerId)
      .maybeSingle();
    const isPrimary = Boolean(contact?.is_primary);

    const { data: items, error: itemsError } = await adminClient
      .from('order_items')
      .select('id, product_snapshot, entrupy_requested, fulfillment_status, order:orders!inner(reseller_id, order_channel, placed_by_profile_id)')
      .in('id', item_ids)
      .eq('status', 'active');
    if (itemsError) return json({ error: itemsError.message }, 500);

    const eligible = (items || []).filter(
      (it: any) =>
        it.entrupy_requested === false &&
        !['delivery_requested', 'shipped'].includes(it.fulfillment_status) &&
        it.order?.order_channel === 'b2b' &&
        it.order?.reseller_id === resellerId &&
        (it.order?.placed_by_profile_id === user.id || isPrimary)
    );
    if (eligible.length !== item_ids.length) {
      return json({ error: 'Certains articles ne sont plus éligibles pour un ajout de certificat Entrupy (déjà certifiés ou livraison déjà demandée)' }, 409);
    }

    const cost = eligible.length * ENTRUPY_CERTIFICATE_PRICE;

    const { data: profile } = await adminClient
      .from('profiles')
      .select('email')
      .eq('id', user.id)
      .maybeSingle();

    const stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-06-20' });
    const origin = req.headers.get('origin') || 'https://admin.ozeparis.com';

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'eur',
            product_data: {
              name: `Certificat d'authenticité Entrupy — ${eligible.length} article${eligible.length > 1 ? 's' : ''}`,
            },
            unit_amount: Math.round(cost * 100),
          },
          quantity: 1,
        },
      ],
      customer_email: profile?.email || user.email || undefined,
      metadata: {
        type: 'entrupy_certificate_request',
        reseller_id: resellerId,
        item_ids: JSON.stringify(eligible.map((it: any) => it.id)),
        cost: String(cost),
      },
      success_url: `${origin}/?b2b_entrupy=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?b2b_entrupy=cancel`,
    });

    return json({ url: session.url });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Erreur inconnue' }, 500);
  }
});
