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

    const { product_ids, shipping_address, billing_address, delivery_type, parcel_point, insured_product_ids, grouped_with_order_id } = await req.json();
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

    // Tarif recalculé ici, jamais accepté depuis le client — même logique de
    // confiance que les prix produits ci-dessous. Doit rester aligné avec
    // SHIPPING_RATES dans ShippingForm.tsx (front, affichage uniquement).
    const SHIPPING_RATES: Record<string, number> = { point_relais: 4.9, domicile: 14.9 };
    if (delivery_type !== 'point_relais' && delivery_type !== 'domicile') {
      return new Response(JSON.stringify({ error: 'Mode de livraison invalide' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (delivery_type === 'point_relais' && (!parcel_point?.name || !parcel_point?.zipCode || !parcel_point?.city)) {
      return new Response(JSON.stringify({ error: 'Point relais incomplet' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const shippingCost = SHIPPING_RATES[delivery_type];

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

    // Assurance Sendcloud optionnelle (0.6% de la valeur de l'article),
    // recalculée ici à partir des prix produits déjà vérifiés — jamais
    // acceptée telle quelle du client. Doit rester alignée avec
    // INSURANCE_RATE dans useB2BCart.ts (front, affichage uniquement).
    const INSURANCE_RATE = 0.006;
    const insuredIds: string[] = Array.isArray(insured_product_ids) ? insured_product_ids : [];
    const insuredProducts = products.filter((p) => insuredIds.includes(p.id));
    const insuranceCost = insuredProducts.reduce((sum, p) => sum + Math.round(Number(p.sale_price) * INSURANCE_RATE * 100) / 100, 0);
    // Valeur déclarée à assurer auprès de Sendcloud (insured_value du colis) —
    // distincte de la prime insuranceCost payée par le client.
    const insuredValue = insuredProducts.reduce((sum, p) => sum + Number(p.sale_price), 0);

    // Remise dégressive sur volume, paliers stricts : <5 articles = 0%,
    // 5-9 = 5%, 10+ = 10% (plafond absolu). Recalculée ici sur le NOMBRE
    // RÉEL de produits disponibles, jamais sur celui envoyé par le client, et
    // ne porte que sur la valeur des articles — jamais sur la livraison ni
    // l'assurance. Doit rester alignée avec volumeDiscount.ts (front,
    // affichage uniquement).
    const itemCount = products.length;
    const discountRate = itemCount >= 10 ? 0.1 : itemCount >= 5 ? 0.05 : 0;
    const rawSubtotal = products.reduce((sum, p) => sum + Number(p.sale_price), 0);
    const discountAmount = Math.round(rawSubtotal * discountRate * 100) / 100;

    // Commande groupée : livraison gratuite si le client rattache cette
    // commande à une commande précédente déjà payée et pas encore expédiée.
    // Revalidé entièrement ici — jamais de confiance sur un "c'est gratuit"
    // envoyé par le client, même logique que les prix produits/livraison.
    let finalShippingCost = shippingCost;
    let validGroupedOrderId: string | null = null;
    if (grouped_with_order_id) {
      const { data: groupOrder } = await adminClient
        .from('orders')
        .select('id, placed_by_profile_id, payment_status, status, created_at')
        .eq('id', grouped_with_order_id)
        .maybeSingle();

      const cutoff = Date.now() - 21 * 24 * 60 * 60 * 1000;
      const isEligible =
        groupOrder &&
        groupOrder.placed_by_profile_id === user.id &&
        groupOrder.payment_status === 'paid' &&
        !['shipped', 'delivered', 'cancelled'].includes(groupOrder.status) &&
        new Date(groupOrder.created_at).getTime() >= cutoff;

      if (isEligible) {
        finalShippingCost = 0;
        validGroupedOrderId = groupOrder.id;
      }
    }

    const { data: profile } = await adminClient
      .from('profiles')
      .select('email, first_name, last_name, phone')
      .eq('id', user.id)
      .single();
    const email = profile?.email || user.email || '';
    const contactName = `${profile?.first_name || ''} ${profile?.last_name || ''}`.trim() || 'Revendeur';
    const phone = profile?.phone || '';

    // Destination réelle de l'expédition, dans le format attendu par
    // l'intégration Sendcloud partagée (voir oze-storefront/supabase/functions/
    // sendcloud-label et _shared/finalizeOrder.ts : sa.address, sa.postcode,
    // sa.pickup_point_code/network, sa.name, sa.phone — mêmes noms de champs
    // que côté B2C, pour réutiliser la même fonction de création de colis
    // sans dupliquer l'intégration). L'adresse entreprise reste toujours
    // l'adresse de facturation.
    const deliveryAddress = delivery_type === 'point_relais'
      ? {
          pickup_point_code: parcel_point.code,
          pickup_point_network: parcel_point.network,
          pickup_point_name: parcel_point.name,
          pickup_point_address: parcel_point.address,
          pickup_point_zip: parcel_point.zipCode,
          pickup_point_city: parcel_point.city,
          city: parcel_point.city,
          postcode: parcel_point.zipCode,
          country: parcel_point.country || 'FR',
          name: contactName,
          phone,
        }
      : {
          address: shipping_address.line1,
          city: shipping_address.city,
          postcode: shipping_address.postal_code,
          country: shipping_address.country,
          name: contactName,
          phone,
        };

    const stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-06-20' });
    const origin = req.headers.get('origin') || 'https://admin.ozeparis.com';

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        ...products.map((p) => ({
          price_data: {
            currency: 'eur',
            product_data: {
              name: discountRate > 0 ? `${p.name} (remise volume -${discountRate * 100}%)` : p.name,
              images: p.images?.[p.main_image_index ?? 0] ? [p.images[p.main_image_index ?? 0]] : undefined,
            },
            // La remise est appliquée directement sur chaque ligne produit :
            // Stripe Checkout n'accepte pas de line_item à montant négatif,
            // donc pas de ligne "Remise" séparée possible ici (elle reste
            // visible dans notre propre récapitulatif et sur la commande).
            unit_amount: Math.round(Number(p.sale_price) * (1 - discountRate) * 100),
          },
          quantity: 1,
        })),
        {
          price_data: {
            currency: 'eur',
            product_data: {
              name: validGroupedOrderId
                ? 'Livraison — Groupée (gratuite)'
                : delivery_type === 'point_relais' ? 'Livraison — Point Relais' : 'Livraison — À l\'entreprise',
            },
            unit_amount: Math.round(finalShippingCost * 100),
          },
          quantity: 1,
        },
        ...(insuranceCost > 0
          ? [{
              price_data: {
                currency: 'eur',
                product_data: { name: 'Assurance colis (Sendcloud)' },
                unit_amount: Math.round(insuranceCost * 100),
              },
              quantity: 1,
            }]
          : []),
      ],
      customer_email: email || undefined,
      metadata: {
        reseller_id: resellerId,
        placed_by_profile_id: user.id,
        product_ids: JSON.stringify(products.map((p) => p.id)),
        shipping_address: JSON.stringify({ ...deliveryAddress, delivery_type, parcel_point: parcel_point || null }),
        billing_address: JSON.stringify(billing_address || shipping_address),
        shipping_cost: String(finalShippingCost),
        insured_product_ids: JSON.stringify(insuredProducts.map((p) => p.id)),
        insurance_cost: String(insuranceCost),
        insured_value: String(insuredValue),
        discount_rate: String(discountRate),
        discount_amount: String(discountAmount),
        grouped_with_order_id: validGroupedOrderId || '',
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
