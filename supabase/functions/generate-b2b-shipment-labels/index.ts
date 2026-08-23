// Edge Function : generate-b2b-shipment-labels
//
// Génère 1 étiquette Sendcloud par colis configuré pour un shipment B2B
// (voir 0062_shipments_schema.sql / 0063_shipment_fulfillment_rpcs.sql).
// PREMIER appel Sendcloud côté oze-admin — reprend à l'identique le pattern
// déjà éprouvé côté oze-storefront (finalizeOrder.ts / bright-processor) :
// même endpoint v3, mêmes headers, même parsing de réponse, y compris le
// fallback "point relais saisi manuellement" (pas de code Sendcloud réel →
// pas de to_service_point, colis adressé directement au point relais).
//
// Différence structurelle : ici il n'y a pas UNE commande avec UNE adresse
// figée au checkout, mais un shipment (regroupement d'articles demandés par
// un revendeur) dont l'adresse de livraison a été choisie au moment de la
// demande (delivery_type/parcel_point sur `shipments`, voir
// reseller_request_item_delivery) — et potentiellement PLUSIEURS colis, un
// appel Sendcloud séparé par colis (jamais un seul appel avec plusieurs
// entrées dans `parcels`, cf. plan).
//
// Chaque colis est validé et commité indépendamment : un échec sur le colis
// 2 ne remet pas en cause le colis 1 déjà expédié — voir la boucle
// séquentielle plus bas.
//
// Réservé aux admins OZË (profiles.role='admin').
// Déploiement : `supabase functions deploy generate-b2b-shipment-labels`

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const SENDER_ADDRESS = {
  name: 'OZË PARIS',
  company_name: 'OZË PARIS',
  address_line_1: "6 Rue d'Armaillé",
  house_number: '6',
  postal_code: '75017',
  city: 'Paris',
  country_code: 'FR',
  phone_number: '+33767602910',
  email: 'contact@ozeparis.com',
};

const COUNTRY_CODES: Record<string, string> = {
  france: 'FR', belgique: 'BE', belgium: 'BE', suisse: 'CH', switzerland: 'CH', luxembourg: 'LU',
};

const toCountryCode = (raw: string | null | undefined): string => {
  const s = String(raw || 'FR').trim();
  return (s.length === 2 ? s : (COUNTRY_CODES[s.toLowerCase()] || 'FR')).toUpperCase();
};

// Sendcloud (surtout Mondial Relay) valide plus strictement quand la voie et
// le numéro de rue sont dissociés — "12 Rue de la Paix" -> house_number "12",
// address_line_1 "Rue de la Paix". Sans numéro détectable, house_number reste
// vide (Sendcloud l'accepte, une adresse sans numéro n'est pas invalide en soi).
const splitAddress = (raw: string | null | undefined): { line1: string; houseNumber: string } => {
  const s = String(raw || '').trim();
  const m = s.match(/^(\d+\s?(?:bis|ter|quater)?)\b[,\s]+(.+)$/i);
  if (m) return { houseNumber: m[1].trim(), line1: m[2].trim() };
  return { line1: s, houseNumber: '' };
};

// Extrait le message d'erreur le plus précis possible du corps de réponse
// Sendcloud (le détail du champ en cause est souvent dans error.errors, pas
// dans error.message qui reste générique) pour pouvoir diagnostiquer sans
// deviner — voir aussi le log console.error juste avant l'appel.
const describeSendcloudError = (data: Record<string, unknown>, status: number): string => {
  const err = (data?.error as Record<string, unknown>) || null;
  if (err?.message) {
    const fieldErrors = err.errors ? ` — ${JSON.stringify(err.errors)}` : '';
    return `${err.message}${fieldErrors}`;
  }
  if (data?.message) return typeof data.message === 'string' ? data.message : JSON.stringify(data.message);
  if (data && Object.keys(data).length > 0) return JSON.stringify(data);
  return `Erreur Sendcloud (${status})`;
};

const checkoutMethodName = (deliveryType: string, network: string, hasCode: boolean): string => {
  const carrier = network.toLowerCase().includes('mondial') ? 'Mondial Relay' : 'Colissimo';
  return `${carrier} - ${deliveryType === 'point_relais' ? 'Point Relais' : 'Domicile'}`;
};

// Même logique que shipWithFor de finalizeOrder.ts : seul un VRAI point
// Sendcloud (code non-vide) peut être routé via to_service_point/ship_with.
const shipWithFor = (network: string, hasCode: boolean) => {
  if (!hasCode) return null;
  if (network.toLowerCase().includes('mondial')) {
    return { type: 'shipping_option_code', properties: { shipping_option_code: 'mondial_relay:service_point,dualapi/size=l,c2c', contract_id: 7443 } };
  }
  return { type: 'shipping_option_code', properties: { shipping_option_code: 'colissimo:post-office', contract_id: 1337 } };
};

interface ItemRow {
  id: string;
  line_total: number;
  insured: boolean;
  insurance_cost: number;
  fulfillment_status: string;
  shipment_id: string | null;
  product_snapshot: { weight?: number; name?: string } | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const sendcloudPublicKey = Deno.env.get('SENDCLOUD_PUBLIC_KEY');
    const sendcloudSecretKey = Deno.env.get('SENDCLOUD_SECRET_KEY');

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Non authentifié' }, 401);

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await callerClient.auth.getUser();
    if (userError || !user) return json({ error: 'Non authentifié' }, 401);

    const { data: callerProfile } = await callerClient
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();
    if (callerProfile?.role !== 'admin') {
      return json({ error: 'Action réservée aux administrateurs' }, 403);
    }

    if (!sendcloudPublicKey || !sendcloudSecretKey) {
      return json({ error: 'Clés Sendcloud manquantes côté serveur' }, 500);
    }

    const { shipment_id, parcels } = await req.json();
    if (!shipment_id || !Array.isArray(parcels) || parcels.length === 0) {
      return json({ error: 'shipment_id et parcels (au moins 1 colis) sont requis' }, 400);
    }
    for (const p of parcels) {
      if (!Array.isArray(p.item_ids) || p.item_ids.length === 0) {
        return json({ error: 'Chaque colis doit contenir au moins un article' }, 400);
      }
    }
    const allItemIds = parcels.flatMap((p: { item_ids: string[] }) => p.item_ids);
    if (new Set(allItemIds).size !== allItemIds.length) {
      return json({ error: 'Un même article ne peut pas être présent dans deux colis' }, 400);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: shipment, error: shipmentError } = await adminClient
      .from('shipments')
      .select('id, reseller_id, requested_by_profile_id, delivery_type, parcel_point, delivery_instructions, status')
      .eq('id', shipment_id)
      .maybeSingle();
    if (shipmentError || !shipment) {
      return json({ error: 'Shipment introuvable' }, 404);
    }

    const { data: pendingItems, error: itemsError } = await adminClient
      .from('order_items')
      .select('id, line_total, insured, insurance_cost, fulfillment_status, shipment_id, product_snapshot')
      .in('id', allItemIds);
    if (itemsError) {
      return json({ error: itemsError.message }, 500);
    }
    const itemsById = new Map<string, ItemRow>((pendingItems || []).map((it: ItemRow) => [it.id, it]));
    const ineligible = allItemIds.filter((id: string) => {
      const it = itemsById.get(id);
      return !it || it.shipment_id !== shipment_id || it.fulfillment_status !== 'delivery_requested';
    });
    if (ineligible.length > 0) {
      return json({ error: `Articles non éligibles (déjà expédiés ou hors de ce shipment) : ${ineligible.join(', ')}` }, 400);
    }

    // Adresse de destination, résolue une fois — partagée par tous les colis
    // de cet appel (ils appartiennent au même shipment/demande). Pour un VRAI
    // point relais (code Sendcloud connu), le routage physique passe par
    // to_service_point/ship_with plus bas : to_address reste l'identité du
    // revendeur (nom, coordonnées, adresse individuelle déjà collectée à
    // l'activation du compte — voir useResellerAuth.ts), même pattern déjà
    // éprouvé côté oze-storefront (_shared/finalizeOrder.ts). Ce n'est QUE
    // pour un point relais saisi manuellement (pas de code réel, donc aucun
    // routage possible) qu'on retombe sur l'adresse du point relais lui-même,
    // seule information disponible pour acheminer le colis.
    const pp = (shipment.parcel_point || {}) as Record<string, unknown>;
    const network = shipment.delivery_type === 'point_relais' ? String(pp.network || '') : '';
    const hasRealCode = shipment.delivery_type === 'point_relais' && Boolean(pp.code);

    const { data: profile } = await adminClient
      .from('profiles')
      .select('email, phone, first_name, last_name, address, city, postal_code, country')
      .eq('id', shipment.requested_by_profile_id)
      .maybeSingle();
    const email = profile?.email || '';
    const phone = profile?.phone || '';
    const contactName = `${profile?.first_name || ''} ${profile?.last_name || ''}`.trim() || 'Revendeur';

    if (!email || !phone) {
      return json({
        error: `Impossible de générer l'étiquette : ${!email ? 'email' : 'téléphone'} manquant sur le profil du demandeur — requis par Sendcloud (Mondial Relay en particulier). Complétez-le puis réessayez.`,
      }, 400);
    }

    let toAddress: Record<string, unknown>;
    if (shipment.delivery_type === 'point_relais' && !hasRealCode) {
      const { line1, houseNumber } = splitAddress(String(pp.address || pp.name || ''));
      toAddress = {
        name: contactName,
        address_line_1: String(pp.name || line1 || ''),
        ...(pp.address && pp.name ? { address_line_2: String(pp.address) } : {}),
        ...(houseNumber ? { house_number: houseNumber } : {}),
        city: String(pp.city || ''),
        postal_code: String(pp.zipCode || ''),
        country_code: toCountryCode(String(pp.country || 'FR')),
        phone_number: phone,
        email,
      };
    } else {
      const { line1, houseNumber } = splitAddress(profile?.address);
      toAddress = {
        name: contactName,
        address_line_1: line1,
        ...(houseNumber ? { house_number: houseNumber } : {}),
        city: profile?.city || '',
        postal_code: profile?.postal_code || '',
        country_code: toCountryCode(profile?.country),
        phone_number: phone,
        email,
      };
    }

    const deliveryIndicator = checkoutMethodName(shipment.delivery_type, network, hasRealCode);
    const shipWith = shipment.delivery_type === 'point_relais' ? shipWithFor(network, hasRealCode) : null;

    // Boucle SÉQUENTIELLE (pas Promise.all) : chaque colis est commité
    // indépendamment dès son propre succès, sans attendre les autres — un
    // échec sur le colis 2 ne doit jamais remettre en cause le colis 1.
    const results: Array<Record<string, unknown>> = [];

    for (let i = 0; i < parcels.length; i++) {
      const parcel = parcels[i] as { item_ids: string[]; weight_kg?: number };
      const items = parcel.item_ids.map((id: string) => itemsById.get(id)!);

      const weightGrams = items.reduce((sum, it) => sum + Number(it.product_snapshot?.weight || 0), 0);
      // 1.0 kg par défaut si aucun poids produit n'est connu (0.1 kg minimal
      // précédent pouvait être rejeté comme irréaliste par certains
      // transporteurs, Mondial Relay en particulier).
      const weightKg = parcel.weight_kg ?? (weightGrams > 0 ? weightGrams / 1000 : 1.0);
      const totalValue = items.reduce((sum, it) => sum + Number(it.line_total) + (it.insured ? Number(it.insurance_cost) : 0), 0);

      // Toujours recalculé juste avant l'insert : jamais fourni par le
      // client, pour qu'une relance après échec partiel ne puisse jamais
      // entrer en conflit avec un colis déjà expédié (contrainte unique
      // shipment_id+parcel_index).
      const { data: maxRow } = await adminClient
        .from('shipment_parcels')
        .select('parcel_index')
        .eq('shipment_id', shipment_id)
        .order('parcel_index', { ascending: false })
        .limit(1)
        .maybeSingle();
      const parcelIndex = (maxRow?.parcel_index || 0) + 1;

      const payload: Record<string, unknown> = {
        apply_shipping_rules: true,
        apply_shipping_defaults: true,
        delivery_indicator: deliveryIndicator,
        shipping_method_checkout_name: deliveryIndicator,
        order_number: `B2B-SHIP-${shipment_id.slice(0, 8)}-${parcelIndex}`,
        total_order_price: { currency: 'EUR', value: totalValue.toFixed(2) },
        from_address: SENDER_ADDRESS,
        to_address: toAddress,
        parcels: [{ weight: { value: weightKg.toFixed(3), unit: 'kg' } }],
      };
      if (shipWith) payload.ship_with = shipWith;
      if (hasRealCode) {
        payload.to_service_point = { id: String(pp.code) };
      }

      try {
        const res = await fetch('https://panel.sendcloud.sc/api/v3/shipments/announce-with-shipping-rules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + btoa(`${sendcloudPublicKey}:${sendcloudSecretKey}`) },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          const errorMessage = describeSendcloudError(data, res.status);
          console.error('[Sendcloud] Échec création colis', { status: res.status, payload, response: data });
          await adminClient.from('shipment_parcels').insert({
            shipment_id, parcel_index: parcelIndex, status: 'failed', weight_kg: weightKg, error_message: errorMessage,
          });
          results.push({ parcel_index: parcelIndex, item_ids: parcel.item_ids, status: 'failed', error: errorMessage });
          continue;
        }

        const sendcloudShipment = data.data || {};
        const p = (sendcloudShipment.parcels || [])[0] || {};
        const labelDoc = (p.documents || []).find((d: { type: string }) => d.type === 'label');
        const sendcloudParcelId = p.id != null ? String(p.id) : (sendcloudShipment.id != null ? String(sendcloudShipment.id) : '');
        const trackingNumber = p.tracking_number || null;
        const trackingUrl = p.tracking_url || sendcloudShipment.tracking_url || null;
        const labelUrl = labelDoc?.link || null;

        const { data: newParcel, error: insertError } = await adminClient
          .from('shipment_parcels')
          .insert({
            shipment_id, parcel_index: parcelIndex, status: 'shipped',
            sendcloud_parcel_id: sendcloudParcelId, tracking_number: trackingNumber, tracking_url: trackingUrl, label_url: labelUrl,
            weight_kg: weightKg, shipped_at: new Date().toISOString(),
          })
          .select('id')
          .single();
        if (insertError || !newParcel) {
          results.push({ parcel_index: parcelIndex, item_ids: parcel.item_ids, status: 'failed', error: `Colis créé chez Sendcloud mais échec d'enregistrement : ${insertError?.message}` });
          continue;
        }

        await adminClient
          .from('order_items')
          .update({ fulfillment_status: 'shipped', parcel_id: newParcel.id, shipped_at: new Date().toISOString() })
          .in('id', parcel.item_ids);

        results.push({ parcel_index: parcelIndex, item_ids: parcel.item_ids, status: 'shipped', tracking_number: trackingNumber, tracking_url: trackingUrl, label_url: labelUrl });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Erreur réseau Sendcloud inconnue';
        await adminClient.from('shipment_parcels').insert({
          shipment_id, parcel_index: parcelIndex, status: 'failed', weight_kg: weightKg, error_message: errorMessage,
        });
        results.push({ parcel_index: parcelIndex, item_ids: parcel.item_ids, status: 'failed', error: errorMessage });
      }
    }

    const { count: remainingCount } = await adminClient
      .from('order_items')
      .select('id', { count: 'exact', head: true })
      .eq('shipment_id', shipment_id)
      .eq('fulfillment_status', 'delivery_requested');

    const anySucceeded = results.some((r) => r.status === 'shipped');
    let newStatus: string | null = null;
    if ((remainingCount || 0) === 0) {
      newStatus = 'shipped';
    } else if (anySucceeded) {
      newStatus = 'partially_shipped';
    }
    if (newStatus) {
      await adminClient.from('shipments').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', shipment_id);
    }

    return json({ success: true, shipment_status: newStatus || shipment.status, parcels: results });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Erreur inconnue' }, 500);
  }
});
