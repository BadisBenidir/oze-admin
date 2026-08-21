// Edge Function : b2b-request-delivery-checkout
//
// Crée une session de paiement Stripe pour les frais de port d'une demande
// de livraison B2B (articles ready_to_ship sélectionnés par le revendeur).
// Ne crée AUCUN shipment ici — ça n'arrive qu'après paiement confirmé, via
// b2b-stripe-webhook (branche metadata.type === 'b2b_delivery_request') qui
// appelle finalize_b2b_delivery_request. Même architecture que b2b-checkout/
// b2b-stripe-webhook pour le paiement des articles eux-mêmes.
//
// Paiement par carte uniquement (pas de solde B2B pour les frais de port).
// Déploiement : `supabase functions deploy b2b-request-delivery-checkout`

import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@17.7.0?target=deno';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const MAX_POINTS_PER_PARCEL = 6;

interface ParcelBin {
  points: number;
  hasBag: boolean;
}

// Copie identique de src/utils/b2bShippingPricing.ts (front) — recalculée
// ici en autorité, jamais acceptée telle quelle du client.
function packIntoParcels(points: number[]): ParcelBin[] {
  const sorted = [...points].sort((a, b) => b - a);
  const parcels: ParcelBin[] = [];
  for (const p of sorted) {
    const target = parcels.find((parcel) => parcel.points + p <= MAX_POINTS_PER_PARCEL);
    if (target) {
      target.points += p;
      if (p >= 3) target.hasBag = true;
    } else {
      parcels.push({ points: p, hasBag: p >= 3 });
    }
  }
  return parcels;
}

function computeShippingCost(points: number[], deliveryType: string): { parcelCount: number; cost: number } {
  const parcels = packIntoParcels(points);
  const parcelCount = parcels.length;
  const hasBag = parcels.some((p) => p.hasBag);

  if (deliveryType === 'domicile') {
    return { parcelCount, cost: parcelCount * 14.9 };
  }

  let cost: number;
  if (parcelCount === 1) {
    cost = hasBag ? 9.9 : 5.9;
  } else if (parcelCount === 2) {
    cost = 14.99;
  } else if (parcelCount === 3) {
    cost = 19.99;
  } else {
    cost = 19.99 + (parcelCount - 3) * 5;
  }
  return { parcelCount, cost };
}

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

    const { item_ids, delivery_type, parcel_point, instructions } = await req.json();
    if (!Array.isArray(item_ids) || item_ids.length === 0) {
      return json({ error: 'Aucun article sélectionné' }, 400);
    }
    if (delivery_type !== 'domicile' && delivery_type !== 'point_relais') {
      return json({ error: 'Mode de livraison invalide' }, 400);
    }
    if (delivery_type === 'point_relais' && !parcel_point?.name) {
      return json({ error: 'Point relais incomplet' }, 400);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Recharge en confiance : items éligibles + points produits LIVE (jamais
    // le product_snapshot, capturé avant la création de ce champ pour les
    // anciennes commandes).
    const { data: items, error: itemsError } = await adminClient
      .from('order_items')
      .select('id, line_total, fulfillment_status, product_id, order:orders!inner(reseller_id, order_channel)')
      .in('id', item_ids)
      .eq('status', 'active');
    if (itemsError) return json({ error: itemsError.message }, 500);

    const eligible = (items || []).filter(
      (it: any) => it.fulfillment_status === 'ready_to_ship' && it.order?.order_channel === 'b2b' && it.order?.reseller_id === resellerId
    );
    if (eligible.length !== item_ids.length) {
      return json({ error: 'Certains articles ne sont plus disponibles pour une demande de livraison' }, 409);
    }

    const productIds = eligible.map((it: any) => it.product_id);
    const { data: products, error: productsError } = await adminClient
      .from('products')
      .select('id, shipping_points')
      .in('id', productIds);
    if (productsError) return json({ error: productsError.message }, 500);
    const pointsByProduct = new Map((products || []).map((p: any) => [p.id, Number(p.shipping_points) || 1]));

    const points = eligible.map((it: any) => pointsByProduct.get(it.product_id) || 1);
    const { parcelCount, cost } = computeShippingCost(points, delivery_type);

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
              name: `Frais de livraison B2B — ${parcelCount} colis (${delivery_type === 'point_relais' ? 'Point Relais' : 'Domicile'})`,
            },
            unit_amount: Math.round(cost * 100),
          },
          quantity: 1,
        },
      ],
      customer_email: profile?.email || user.email || undefined,
      metadata: {
        type: 'b2b_delivery_request',
        reseller_id: resellerId,
        placed_by_profile_id: user.id,
        item_ids: JSON.stringify(item_ids),
        delivery_type,
        parcel_point: parcel_point ? JSON.stringify(parcel_point) : '',
        instructions: instructions || '',
        shipping_cost: String(cost),
      },
      success_url: `${origin}/?b2b_delivery=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?b2b_delivery=cancel`,
    });

    return json({ url: session.url });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Erreur inconnue' }, 500);
  }
});
