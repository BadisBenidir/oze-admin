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

    const { product_ids, insured_product_ids, entrupy_product_ids, promo_code, payment_method } = await req.json();
    if (!Array.isArray(product_ids) || product_ids.length === 0) {
      return new Response(JSON.stringify({ error: 'Le panier est vide' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Le mode/l'adresse de livraison ne sont plus choisis au checkout : ils le
    // seront au moment de la demande de livraison du lot (voir
    // request_batch_delivery, 0054_delivery_batches.sql). Aucune commande
    // n'est donc facturée de frais de port à ce stade.
    const shippingCost = 0;

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

    // Certificat d'authenticité Entrupy, opt-out (actif par défaut côté
    // panier) : prix fixe recalculé ici en autorité — jamais accepté tel quel
    // du client, seule la LISTE des articles cochés vient du panier. Doit
    // rester alignée avec ENTRUPY_CERTIFICATE_PRICE dans useB2BCart.ts
    // (front, affichage uniquement) et avec finalize_entrupy_certificate_
    // request (0083_entrupy_certificate.sql, ajout post-achat).
    const ENTRUPY_CERTIFICATE_PRICE = 19.99;
    const entrupyIds: string[] = Array.isArray(entrupy_product_ids) ? entrupy_product_ids : [];
    const entrupyProducts = products.filter((p) => entrupyIds.includes(p.id));
    const entrupyCost = Math.round(entrupyProducts.length * ENTRUPY_CERTIFICATE_PRICE * 100) / 100;

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

    // Code promo B2B, optionnel : revalidé intégralement ici via la RPC
    // validate_promo_code (mêmes règles que la vérification temps réel côté
    // panier), avec le CALLER client pour que current_reseller_id()/auth.uid()
    // résolvent bien le revendeur connecté — jamais de confiance sur un
    // montant de remise envoyé par le client.
    let promoCodeId: string | null = null;
    let promoCodeLabel: string | null = null;
    let promoDiscountAmount = 0;
    if (promo_code && String(promo_code).trim()) {
      const { data: promoResult, error: promoError } = await callerClient.rpc('validate_promo_code', {
        p_code: String(promo_code).trim(),
        p_subtotal: rawSubtotal,
      });
      if (promoError) {
        return new Response(JSON.stringify({ error: promoError.message }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (!promoResult?.valid) {
        return new Response(JSON.stringify({ error: promoResult?.error || 'Code promo invalide' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      promoCodeId = promoResult.promo_code_id;
      promoCodeLabel = promoResult.code;
      promoDiscountAmount = Number(promoResult.discount_amount);
    }

    // Sous-total après les DEUX remises (volume + code promo), jamais
    // négatif. Chaque ligne produit est ensuite réduite dans cette même
    // proportion (voir plus bas) : Stripe Checkout n'accepte pas de
    // line_item à montant négatif, donc pas de ligne "Remise" séparée
    // possible — la remise totale reste néanmoins visible telle quelle dans
    // notre propre récapitulatif et sur la commande (discount_amount +
    // promo_discount_amount).
    const subtotalAfterDiscounts = Math.max(0, rawSubtotal - discountAmount - promoDiscountAmount);
    const lineItemRatio = rawSubtotal > 0 ? subtotalAfterDiscounts / rawSubtotal : 1;

    const { data: profile } = await adminClient
      .from('profiles')
      .select('email, first_name, last_name, phone, address, city, postal_code, country')
      .eq('id', user.id)
      .single();
    const email = profile?.email || user.email || '';
    const contactName = `${profile?.first_name || ''} ${profile?.last_name || ''}`.trim() || 'Revendeur';
    const phone = profile?.phone || '';

    // L'adresse de livraison n'est plus connue à ce stade (voir plus haut) —
    // seule l'adresse de l'entreprise (facturation) est conservée sur la
    // commande, à titre d'information ; elle ne sert plus à générer un colis
    // Sendcloud ici (ça n'arrivera qu'à la demande de livraison du lot).
    const billingAddress = {
      address: profile?.address || '',
      city: profile?.city || '',
      postcode: profile?.postal_code || '',
      country: profile?.country || 'France',
      name: contactName,
      phone,
    };

    // orders.shipping_address est NOT NULL : on ne connaît plus l'adresse de
    // livraison réelle au checkout (choisie plus tard, par lot, voir
    // request_batch_delivery), mais on ne peut pas non plus laisser la
    // colonne à null. On y met donc l'adresse entreprise connue à défaut
    // (même valeur que billingAddress), avec une note explicite.
    const shippingAddressPlaceholder = {
      address: profile?.address || null,
      city: profile?.city || null,
      postcode: profile?.postal_code || null,
      country: profile?.country || null,
      note: 'À définir lors de la demande de livraison',
    };

    // Paiement par solde portefeuille : pas de session Stripe du tout, la
    // commande est créée et débitée atomiquement en base via
    // pay_b2b_order_with_wallet (verrouillage de ligne + vérification de
    // solde côté serveur, jamais de confiance sur un solde affiché client).
    if (payment_method === 'wallet') {
      const { data: walletResult, error: walletError } = await adminClient.rpc('pay_b2b_order_with_wallet', {
        p_reseller_id: resellerId,
        p_product_ids: products.map((p) => p.id),
        p_shipping_address: shippingAddressPlaceholder,
        p_billing_address: billingAddress,
        p_email: email,
        p_placed_by_profile_id: user.id,
        p_shipping_cost: shippingCost,
        p_insured_product_ids: insuredProducts.map((p) => p.id),
        p_insurance_cost: insuranceCost,
        p_grouped_with_order_id: null,
        p_insured_value: insuredValue,
        p_discount_rate: discountRate,
        p_discount_amount: discountAmount,
        p_promo_discount_amount: promoDiscountAmount,
        p_entrupy_product_ids: entrupyProducts.map((p) => p.id),
        p_entrupy_cost: entrupyCost,
      });

      if (walletError) {
        const insufficient = walletError.message?.includes('Solde insuffisant');
        return new Response(JSON.stringify({ error: insufficient ? 'Solde insuffisant' : walletError.message }), {
          status: insufficient ? 402 : 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (!walletResult?.order_id) {
        return new Response(JSON.stringify({ error: 'Ces articles ne sont plus disponibles' }), {
          status: 409,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Code promo : pas de webhook sur ce chemin (paiement synchrone), donc
      // l'application définitive se fait ici, juste après la création de la
      // commande — même RPC que le webhook Stripe. Si le code s'avère
      // finalement invalide (épuisé entre-temps par une commande
      // concurrente), on recrédite le solde plutôt que de garder le rabais
      // non honoré : même logique que le remboursement Stripe côté webhook,
      // adaptée au solde puisqu'aucune carte n'a été débitée ici.
      if (promoCodeId) {
        const { data: promoApplyResult } = await adminClient.rpc('record_promo_code_use', {
          p_promo_code_id: promoCodeId,
          p_order_id: walletResult.order_id,
          p_reseller_id: resellerId,
          p_profile_id: user.id,
          p_discount_amount: promoDiscountAmount,
        });
        if (!promoApplyResult?.applied && promoDiscountAmount > 0) {
          await adminClient.rpc('admin_adjust_wallet_balance', {
            p_profile_id: user.id,
            p_amount: promoDiscountAmount,
            p_note: `Recrédit automatique : code promo devenu invalide après paiement par solde (commande ${walletResult.order_id})`,
          });
          await adminClient
            .from('orders')
            .update({ total_amount: Number(walletResult.total) + promoDiscountAmount })
            .eq('id', walletResult.order_id);
        }
      }

      // Programme fidélité : pas de webhook sur ce chemin non plus, donc
      // l'inclusion automatique du cadeau en attente (s'il y en a un) se
      // fait ici — même RPC que le webhook Stripe.
      await adminClient.rpc('attach_pending_loyalty_gift', {
        p_order_id: walletResult.order_id,
        p_reseller_id: resellerId,
      });

      return new Response(JSON.stringify({ order_id: walletResult.order_id, unavailable_ids: unavailableIds }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Paiement mixte : le solde ne couvre qu'une partie du total. On débite
    // immédiatement TOUT le solde disponible (pas un montant choisi par le
    // client — jamais de confiance sur un montant de solde envoyé du front),
    // Stripe ne facture que le reste. Voir 0036_..._mixed_payment.sql pour la
    // finalisation (webhook) ou le remboursement (session expirée sans
    // paiement) de cette part.
    let mixedWalletAmount = 0;
    let chargeRatio = 1;
    const grandTotalBeforeWallet = subtotalAfterDiscounts + shippingCost + insuranceCost + entrupyCost;
    if (payment_method === 'mixed') {
      const { data: profileRow } = await adminClient
        .from('profiles')
        .select('wallet_balance')
        .eq('id', user.id)
        .single();
      const balance = Number(profileRow?.wallet_balance || 0);
      if (balance <= 0 || balance >= grandTotalBeforeWallet) {
        return new Response(JSON.stringify({ error: "Paiement mixte non applicable : utilisez 'wallet' (solde suffisant) ou 'card' (aucun solde à utiliser)" }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      mixedWalletAmount = balance;
      const remainder = grandTotalBeforeWallet - mixedWalletAmount;
      chargeRatio = grandTotalBeforeWallet > 0 ? remainder / grandTotalBeforeWallet : 0;
    }

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
            unit_amount: Math.round(Number(p.sale_price) * lineItemRatio * chargeRatio * 100),
          },
          quantity: 1,
        })),
        ...(insuranceCost > 0
          ? [{
              price_data: {
                currency: 'eur',
                product_data: { name: 'Assurance colis (Sendcloud)' },
                unit_amount: Math.round(insuranceCost * chargeRatio * 100),
              },
              quantity: 1,
            }]
          : []),
        ...(entrupyCost > 0
          ? [{
              price_data: {
                currency: 'eur',
                product_data: { name: `Certificat d'authenticité Entrupy (${entrupyProducts.length} article${entrupyProducts.length > 1 ? 's' : ''})` },
                unit_amount: Math.round(entrupyCost * chargeRatio * 100),
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
        // L'adresse de livraison n'est plus connue au checkout — seule
        // l'adresse entreprise (facturation) est transmise ici, avec un
        // placeholder pour shipping_address (colonne NOT NULL, voir
        // shippingAddressPlaceholder plus haut).
        shipping_address: JSON.stringify(shippingAddressPlaceholder),
        billing_address: JSON.stringify(billingAddress),
        insured_product_ids: JSON.stringify(insuredProducts.map((p) => p.id)),
        insurance_cost: String(insuranceCost),
        insured_value: String(insuredValue),
        entrupy_product_ids: JSON.stringify(entrupyProducts.map((p) => p.id)),
        entrupy_cost: String(entrupyCost),
        discount_rate: String(discountRate),
        discount_amount: String(discountAmount),
        promo_code_id: promoCodeId || '',
        promo_code: promoCodeLabel || '',
        promo_discount_amount: String(promoDiscountAmount),
        wallet_amount_used: String(mixedWalletAmount),
        email,
      },
      success_url: `${origin}/?b2b_checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?b2b_checkout=cancel`,
    });

    // Paiement mixte : débite le solde MAINTENANT que la session existe (le
    // débit est lié à session.id pour être finalisé ou remboursé selon
    // l'issue du paiement — voir b2b-stripe-webhook). En cas d'échec (très
    // rare course concurrente), on n'envoie surtout pas au client une session
    // Stripe dont le montant suppose à tort que le solde la complète : elle
    // reste orpheline et expire d'elle-même sans qu'aucune charge n'ait lieu.
    if (payment_method === 'mixed' && mixedWalletAmount > 0) {
      const { error: debitError } = await adminClient.rpc('debit_wallet_amount', {
        p_profile_id: user.id,
        p_reseller_id: resellerId,
        p_amount: mixedWalletAmount,
        p_stripe_session_id: session.id,
      });
      if (debitError) {
        return new Response(JSON.stringify({ error: "Le solde a changé entre-temps, réessayez le paiement." }), {
          status: 409,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

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
