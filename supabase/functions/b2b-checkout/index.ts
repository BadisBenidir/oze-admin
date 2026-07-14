// Edge Function : b2b-checkout
//
// Crée une session de paiement Stripe pour le panier B2B d'un revendeur. Ne
// crée AUCUNE commande ni réservation ici : ça n'arrive qu'après paiement
// confirmé, via le webhook b2b-stripe-webhook. Les prix sont toujours
// recalculés côté serveur depuis `products`, jamais acceptés depuis le panier
// client.
// Déploiement : `supabase functions deploy b2b-checkout`

import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@17.7.0?target=deno';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Non authentifié' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');

    if (!stripeSecretKey) {
      return new Response(JSON.stringify({ error: 'STRIPE_SECRET_KEY manquant dans les secrets Supabase' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await callerClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Non authentifié' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // current_reseller_id() ne renvoie une valeur que pour un contact actif
    // d'un revendeur au statut 'active' (voir migration 0001).
    const { data: resellerId } = await callerClient.rpc('current_reseller_id');
    if (!resellerId) {
      return new Response(JSON.stringify({ error: 'Aucun compte revendeur actif associé à cet utilisateur' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { product_ids, shipping_address, billing_address } = await req.json();
    if (!Array.isArray(product_ids) || product_ids.length === 0) {
      return new Response(JSON.stringify({ error: 'Le panier est vide' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!shipping_address?.line1 || !shipping_address?.city || !shipping_address?.postal_code) {
      return new Response(JSON.stringify({ error: 'Adresse de livraison incomplète' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Client service-role : products est en RLS deny-all pour le rôle
    // revendeur (l'accès catalogue passe par la vue b2b_catalog), donc on lit
    // ici avec des privilèges élevés pour recalculer les prix en confiance.
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: products, error: productsError } = await adminClient
      .from('products')
      .select('id, name, sale_price, images, main_image_index')
      .in('id', product_ids)
      .eq('status', 'for-sale-b2b');

    if (productsError) {
      return new Response(JSON.stringify({ error: productsError.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!products || products.length === 0) {
      return new Response(JSON.stringify({ error: 'Ces articles ne sont plus disponibles' }), {
        status: 409,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const unavailableIds = product_ids.filter((id: string) => !products.some((p) => p.id === id));

    const { data: profile } = await adminClient.from('profiles').select('email').eq('id', user.id).single();
    const email = profile?.email || user.email || '';

    const stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-06-20' });
    const origin = req.headers.get('origin') || 'https://admin.ozeparis.com';

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: products.map((p) => ({
        price_data: {
          currency: 'eur',
          product_data: {
            name: p.name,
            images: p.images?.[p.main_image_index ?? 0] ? [p.images[p.main_image_index ?? 0]] : undefined,
          },
          unit_amount: Math.round(Number(p.sale_price) * 100),
        },
        quantity: 1,
      })),
      customer_email: email || undefined,
      metadata: {
        reseller_id: resellerId,
        placed_by_profile_id: user.id,
        product_ids: JSON.stringify(products.map((p) => p.id)),
        shipping_address: JSON.stringify(shipping_address),
        billing_address: JSON.stringify(billing_address || shipping_address),
        email,
      },
      success_url: `${origin}/?b2b_checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?b2b_checkout=cancel`,
    });

    return new Response(JSON.stringify({ url: session.url, unavailable_ids: unavailableIds }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Erreur inconnue' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
