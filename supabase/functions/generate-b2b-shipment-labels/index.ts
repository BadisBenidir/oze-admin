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

// Repli quand aucun pays explicite n'est fourni par le point relais (le
// widget de sélection ne renseigne pas toujours ce champ) : un code postal à
// 4 chiffres n'est JAMAIS un vrai code postal français (toujours 5 chiffres),
// et correspond en pratique presque toujours à la Belgique pour nos
// revendeurs. Cas réel corrigé ici : un point relais belge (ex. "1090
// JETTE") envoyé à Sendcloud avec country_code="FR" par défaut silencieux —
// Sendcloud ne trouve alors aucune règle d'expédition pour FR + un code
// postal qui n'existe pas en France ("No shipping option could be found for
// the given country or postal code combination").
const guessCountryFromPostalCode = (postalCode: string | null | undefined): string | null => {
  const digits = String(postalCode || '').trim();
  if (/^\d{4}$/.test(digits)) return 'BE';
  if (/^\d{5}$/.test(digits)) return 'FR';
  return null;
};

const toCountryCode = (raw: string | null | undefined, postalCodeHint?: string | null): string => {
  const s = String(raw || '').trim();
  const postalGuess = guessCountryFromPostalCode(postalCodeHint);
  // Un code postal à 4 chiffres n'est JAMAIS un vrai code postal français
  // (toujours 5 chiffres) : ce signal prime donc sur un pays stocké valant
  // "FR", car ce dernier peut être un défaut silencieux erroné posé côté
  // widget de sélection du point relais (voir sendcloudService.ts
  // mapServicePoint, qui a longtemps défaulté `country` sur "FR" quand
  // Sendcloud ne renvoyait pas ce champ) plutôt qu'une vraie valeur — cas
  // réel : le point relais "PRESS SHOP REINE ASTRID" à 1090 Jette (Belgique)
  // était enregistré avec country="FR", empêchant toute détection auto de
  // basculer sur Mondial Relay malgré la correction précédente.
  if (postalGuess === 'BE' && (!s || s.toUpperCase() === 'FR')) {
    return 'BE';
  }
  if (s) {
    return (s.length === 2 ? s : (COUNTRY_CODES[s.toLowerCase()] || 'FR')).toUpperCase();
  }
  return postalGuess || 'FR';
};

// Sendcloud rejette silencieusement (ou avec une erreur de validation peu
// lisible) tout champ dépassant sa longueur maximale — ex. "Ensure this
// value has at most 30 characters" sur city quand le widget de sélection du
// point relais concatène parfois un nom de boutique à la ville. Tronquer
// systématiquement plutôt que de faire confiance à la donnée source, qu'on
// ne contrôle pas (widget tiers / saisie manuelle du revendeur).
const truncate = (value: unknown, maxLength: number): string =>
  String(value || '').trim().slice(0, maxLength);

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

// Copie identique de src/utils/phoneValidation.ts (front).
const isPlausiblePhone = (raw: string | null | undefined): boolean => {
  const digits = String(raw || '').replace(/[\s.\-()]/g, '');
  return /^\+?[0-9]{8,15}$/.test(digits);
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

type CarrierOverride = 'mondial_relay' | 'colissimo' | null;

// Décide Mondial Relay vs Colissimo. Le texte `network` (renvoyé par le point
// relais choisi par le revendeur) est le signal par défaut, mais NE SUFFIT
// PAS seul : cas réel qui cassait la génération — "PRESS SHOP REINE ASTRID"
// à Jette (Belgique) était étiqueté "Colissimo" côté network, alors que le
// contrat Colissimo de ce compte Sendcloud ne couvre AUCUN point de retrait
// hors France (seul Mondial Relay le fait) → Sendcloud répondait "No
// shipping option could be found for the given country or postal code
// combination". Le pays RÉEL du point relais (relayCountry, jamais celui de
// l'adresse du revendeur — voir son calcul plus bas) prime donc sur le texte
// network dès qu'on est hors France en point relais — et cette règle est
// PRIORITAIRE ABSOLUE, y compris sur `carrierOverride` (sélecteur manuel
// admin, voir ParcelSplitEditor.tsx) : un point relais hors France ne peut
// PHYSIQUEMENT pas partir via Colissimo sur ce compte (aucune couverture de
// point de retrait hors France sur ce contrat), donc honorer un override
// 'colissimo' dans ce cas précis ne ferait jamais qu'échouer à coup sûr.
// `carrierOverride` ne sert donc qu'à trancher les cas ambigus (network
// illisible, France) où les deux transporteurs sont réellement possibles.
const resolveCarrier = (deliveryType: string, network: string, relayCountry: string, carrierOverride: CarrierOverride): 'mondial_relay' | 'colissimo' => {
  const forceMondial = deliveryType === 'point_relais' && relayCountry !== 'FR';
  if (forceMondial) return 'mondial_relay';
  if (carrierOverride) return carrierOverride;
  return network.toLowerCase().includes('mondial') ? 'mondial_relay' : 'colissimo';
};

const checkoutMethodName = (deliveryType: string, carrier: 'mondial_relay' | 'colissimo'): string => {
  const label = carrier === 'mondial_relay' ? 'Mondial Relay' : 'Colissimo';
  return `${label} - ${deliveryType === 'point_relais' ? 'Point Relais' : 'Domicile'}`;
};

// Même logique que shipWithFor de finalizeOrder.ts : seul un VRAI point
// Sendcloud (code non-vide) peut être routé via to_service_point/ship_with.
//
// ⚠️ contract_id (7443 Mondial Relay, 1337 Colissimo) est un identifiant de
// CONTRAT Sendcloud propre au compte OZË. Le contrat Colissimo est confirmé
// France uniquement (voir commentaire de resolveCarrier ci-dessus) — jamais
// utilisé hors France en point relais, quel que soit `network`.
//
// ⚠️ Le shipping_option_code "mondial_relay:service_point,dualapi/size=l,c2c"
// (+ contract_id 7443) est lui-même confirmé FR uniquement : reproduit en
// conditions réelles sur le cas Jette (Belgique), Sendcloud renvoie 400 "No
// shipping option could be found for the given country or postal code
// combination" EXACTEMENT sur ce couple option/contrat, même une fois le
// carrier et to_address.country_code correctement forcés sur 'BE'.
//
// ⚠️ Omettre complètement ship_with (en comptant sur apply_shipping_defaults)
// a ensuite échoué avec une AUTRE erreur Sendcloud confirmée : "No shipping
// rules were found that define the 'ship_with' for this shipment" — avec
// apply_shipping_rules:false (nécessaire pour éviter la règle d'assurance
// dashboard, voir plus haut), Sendcloud EXIGE un ship_with explicite, il n'y
// a pas de résolution automatique possible. On tente donc le flux "b2c" du
// même contrat Mondial Relay (7443) plutôt que "c2c" (réservé au dépôt
// particulier FR) pour la destination internationale. Si cela échoue aussi,
// voir le diagnostic `shipping_methods_diagnostic` loggé juste avant l'appel
// Sendcloud (liste des méthodes Mondial Relay réellement actives pour ce
// pays/ce point relais sur CE compte) plutôt que deviner un 3e code à
// l'aveugle — on ne peut pas vérifier depuis ce code lequel de ces slugs
// existe réellement sans accès direct au compte Sendcloud.
const shipWithFor = (carrier: 'mondial_relay' | 'colissimo', hasCode: boolean, isFrenchDestination: boolean) => {
  if (!hasCode) return null;
  if (carrier === 'mondial_relay') {
    return isFrenchDestination
      ? { type: 'shipping_option_code', properties: { shipping_option_code: 'mondial_relay:service_point,dualapi/size=l,c2c', contract_id: 7443 } }
      : { type: 'shipping_option_code', properties: { shipping_option_code: 'mondial_relay:service_point,dualapi/size=l,b2c', contract_id: 7443 } };
  }
  return { type: 'shipping_option_code', properties: { shipping_option_code: 'colissimo:post-office', contract_id: 1337 } };
};

// Diagnostic best-effort (jamais bloquant) : liste les méthodes d'expédition
// v2 réellement actives sur ce compte pour ce pays + ce point relais précis.
// Sert uniquement à alimenter le log en cas de nouvel échec du couple
// shipping_option_code ci-dessus, pour remplacer une 3e supposition à
// l'aveugle par une preuve concrète (nom exact, transporteur, id) de ce qui
// est vraiment disponible sur ce compte — jamais injecté dans le payload v3
// lui-même : Sendcloud confirme que les ID de méthode v2 ne sont pas
// directement réutilisables dans l'API v3 (qui attend un shipping_option_code,
// pas un id v2), donc un mappage automatique aurait été une supposition de
// plus, pas une garantie.
const fetchShippingMethodsDiagnostic = async (
  publicKey: string,
  secretKey: string,
  toCountry: string,
  servicePointId: string,
): Promise<unknown> => {
  try {
    const url = `https://panel.sendcloud.sc/api/v2/shipping_methods?to_country=${encodeURIComponent(toCountry)}&service_point_id=${encodeURIComponent(servicePointId)}`;
    const res = await fetch(url, { headers: { Authorization: 'Basic ' + btoa(`${publicKey}:${secretKey}`) } });
    const data = await res.json().catch(() => null);
    return { status: res.status, shipping_methods: (data as { shipping_methods?: unknown })?.shipping_methods ?? data };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Échec appel diagnostic shipping_methods' };
  }
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

    const { shipment_id, parcels, phone_override, carrier_override } = await req.json();
    if (!shipment_id || !Array.isArray(parcels) || parcels.length === 0) {
      return json({ error: 'shipment_id et parcels (au moins 1 colis) sont requis' }, 400);
    }
    const carrierOverride: CarrierOverride =
      carrier_override === 'mondial_relay' || carrier_override === 'colissimo' ? carrier_override : null;
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
    // to_service_point/ship_with plus bas ; to_address garde l'identité du
    // revendeur (nom, coordonnées) — MAIS pas son pays/code postal, qui
    // doivent être ceux du point relais (voir plus bas, cas réel Jette/
    // Belgique où profil et point relais étaient dans deux pays différents,
    // ce que Sendcloud rejette). Un point relais saisi manuellement (pas de
    // code réel) utilise l'adresse du point relais en intégralité, seule
    // information disponible pour acheminer le colis.
    const pp = (shipment.parcel_point || {}) as Record<string, unknown>;
    const network = shipment.delivery_type === 'point_relais' ? String(pp.network || '') : '';
    const hasRealCode = shipment.delivery_type === 'point_relais' && Boolean(pp.code);
    // Pays RÉEL du point relais — jamais celui de to_address (qui, pour un
    // point avec code Sendcloud connu, reste l'identité/adresse du revendeur,
    // voir plus bas) : le choix du transporteur doit se baser sur où le colis
    // part PHYSIQUEMENT, pas sur l'adresse de facturation du destinataire.
    const relayCountry = shipment.delivery_type === 'point_relais'
      ? toCountryCode(String(pp.country || ''), String(pp.zipCode || ''))
      : 'FR';
    const carrier = resolveCarrier(shipment.delivery_type, network, relayCountry, carrierOverride);
    console.log('[Sendcloud] Résolution transporteur', {
      shipment_id, delivery_type: shipment.delivery_type, network, relayCountry, carrierOverride, hasRealCode, carrier,
      parcel_point_country_raw: pp.country, parcel_point_zip: pp.zipCode,
    });
    if (hasRealCode && relayCountry !== 'FR') {
      const diagnostic = await fetchShippingMethodsDiagnostic(sendcloudPublicKey, sendcloudSecretKey, relayCountry, String(pp.code));
      console.log('[Sendcloud] Méthodes disponibles pour ce pays/point relais (diagnostic, non utilisé dans le payload)', diagnostic);
    }

    const { data: profile } = await adminClient
      .from('profiles')
      .select('email, phone, first_name, last_name, address, city, postal_code, country')
      .eq('id', shipment.requested_by_profile_id)
      .maybeSingle();
    const email = profile?.email || '';
    // Saisie de secours admin : si le profil n'a pas de téléphone valide,
    // l'admin peut en fournir un depuis la modale de génération plutôt que
    // d'échouer — enregistré sur le profil du demandeur pour ne plus jamais
    // avoir à le ressaisir aux prochaines générations.
    const phone = isPlausiblePhone(profile?.phone) ? profile!.phone! : (isPlausiblePhone(phone_override) ? String(phone_override).trim() : '');
    const contactName = `${profile?.first_name || ''} ${profile?.last_name || ''}`.trim() || 'Revendeur';

    if (!email) {
      return json({
        error: `Impossible de générer l'étiquette : email manquant sur le profil du demandeur — requis par Sendcloud. Complétez-le puis réessayez.`,
      }, 400);
    }
    if (!phone) {
      return json({
        error: `Numéro de téléphone manquant ou invalide sur le profil du demandeur — requis par Sendcloud (Mondial Relay en particulier). Saisissez un numéro valide pour générer le bordereau.`,
      }, 400);
    }
    if (isPlausiblePhone(phone_override) && phone_override.trim() !== (profile?.phone || '')) {
      await adminClient.from('profiles').update({ phone: String(phone_override).trim() }).eq('id', shipment.requested_by_profile_id);
    }

    let toAddress: Record<string, unknown>;
    if (shipment.delivery_type === 'point_relais' && !hasRealCode) {
      const { line1, houseNumber } = splitAddress(String(pp.address || pp.name || ''));
      const zipCode = String(pp.zipCode || '');
      toAddress = {
        name: truncate(contactName, 40),
        address_line_1: truncate(pp.name || line1 || '', 40),
        ...(pp.address && pp.name ? { address_line_2: truncate(pp.address, 40) } : {}),
        ...(houseNumber ? { house_number: houseNumber } : {}),
        city: truncate(pp.city, 30),
        postal_code: truncate(zipCode, 10),
        country_code: toCountryCode(String(pp.country || ''), zipCode),
        phone_number: phone,
        email,
      };
    } else {
      const { line1, houseNumber } = splitAddress(profile?.address);
      // Pays/code postal : pour un point relais (hasRealCode), ce sont ceux
      // du POINT RELAIS lui-même qui priment, jamais ceux du profil du
      // revendeur — cas réel qui cassait Jette (Belgique) malgré un carrier
      // déjà correctement forcé sur Mondial Relay : to_address portait le
      // pays/code postal du profil du revendeur (France), incohérent avec un
      // to_service_point situé en Belgique, ce que Sendcloud rejette avec
      // exactement "No shipping option could be found for the given country
      // or postal code combination" (le message cite express. country ET
      // postal code). Pour une livraison à domicile, ces champs restent
      // évidemment ceux du profil — seule vraie adresse de destination.
      const isRelayDelivery = shipment.delivery_type === 'point_relais';
      toAddress = {
        name: truncate(contactName, 40),
        address_line_1: truncate(line1, 40),
        ...(houseNumber ? { house_number: houseNumber } : {}),
        city: truncate(profile?.city, 30),
        postal_code: isRelayDelivery ? truncate(pp.zipCode, 10) : truncate(profile?.postal_code, 10),
        country_code: isRelayDelivery ? relayCountry : toCountryCode(profile?.country, profile?.postal_code),
        phone_number: phone,
        email,
      };
    }

    const deliveryIndicator = checkoutMethodName(shipment.delivery_type, carrier);
    const shipWith = shipment.delivery_type === 'point_relais' ? shipWithFor(carrier, hasRealCode, relayCountry === 'FR') : null;

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

      // apply_shipping_rules: false — cas réel qui cassait Jette (Belgique)
      // malgré un carrier/contrat déjà correct (Mondial Relay) : Sendcloud
      // applique côté panel une règle d'expédition dashboard ("Assurance
      // pour les commandes de haute valeur", id 325800, visible dans
      // applied_shipping_rules de la réponse d'erreur) qui force une option
      // d'assurance non supportée par ce transporteur/cette destination,
      // provoquant "No shipping option could be found...". On ne gère JAMAIS
      // l'assurance via une règle dashboard opaque et non contrôlée depuis
      // ce code — total_insured_value n'est d'ailleurs jamais envoyé ici.
      const payload: Record<string, unknown> = {
        apply_shipping_rules: false,
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

      // Log intégral avant l'appel Sendcloud — permet de voir exactement ce
      // qui a été transmis en cas de nouvel échec, sans devoir reproduire
      // l'appel manuellement pour inspecter le payload.
      console.log('[Sendcloud] Payload envoyé', JSON.stringify(payload));

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
          results.push({ parcel_index: parcelIndex, item_ids: parcel.item_ids, status: 'failed', carrier, error: errorMessage });
          continue;
        }

        const sendcloudShipment = data.data || {};
        const p = (sendcloudShipment.parcels || [])[0] || {};
        const labelDoc = (p.documents || []).find((d: { type: string }) => d.type === 'label');
        const sendcloudParcelId = p.id != null ? String(p.id) : (sendcloudShipment.id != null ? String(sendcloudShipment.id) : '');
        const trackingNumber = p.tracking_number || null;
        const trackingUrl = p.tracking_url || sendcloudShipment.tracking_url || null;
        const labelUrl = labelDoc?.link || null;

        // 'label_created', pas 'shipped' : le bordereau est imprimé mais rien
        // ne garantit que le colis a déjà été remis au transporteur — voir
        // 0086_shipment_tracking_lifecycle.sql. Le passage à 'shipped' (vraie
        // prise en charge) puis 'delivered' arrive plus tard, via
        // sendcloud-webhook ou sendcloud-sync-tracking.
        const { data: newParcel, error: insertError } = await adminClient
          .from('shipment_parcels')
          .insert({
            shipment_id, parcel_index: parcelIndex, status: 'label_created',
            sendcloud_parcel_id: sendcloudParcelId, tracking_number: trackingNumber, tracking_url: trackingUrl, label_url: labelUrl,
            weight_kg: weightKg, label_created_at: new Date().toISOString(),
          })
          .select('id')
          .single();
        if (insertError || !newParcel) {
          results.push({ parcel_index: parcelIndex, item_ids: parcel.item_ids, status: 'failed', carrier, error: `Colis créé chez Sendcloud mais échec d'enregistrement : ${insertError?.message}` });
          continue;
        }

        await adminClient
          .from('order_items')
          .update({ fulfillment_status: 'label_created', parcel_id: newParcel.id, label_created_at: new Date().toISOString() })
          .in('id', parcel.item_ids);

        results.push({ parcel_index: parcelIndex, item_ids: parcel.item_ids, status: 'label_created', carrier, tracking_number: trackingNumber, tracking_url: trackingUrl, label_url: labelUrl });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Erreur réseau Sendcloud inconnue';
        await adminClient.from('shipment_parcels').insert({
          shipment_id, parcel_index: parcelIndex, status: 'failed', weight_kg: weightKg, error_message: errorMessage,
        });
        results.push({ parcel_index: parcelIndex, item_ids: parcel.item_ids, status: 'failed', carrier, error: errorMessage });
      }
    }

    // Agrégat partagé avec apply_sendcloud_parcel_status / admin_revert_item_
    // to_received / admin_unassign_items_from_parcel — voir
    // recompute_shipment_status (0086_shipment_tracking_lifecycle.sql) :
    // 'preparing' dès qu'au moins un colis a une étiquette, peu importe s'il
    // en reste d'autres encore à préparer.
    let newStatus: string | null = null;
    const anySucceeded = results.some((r) => r.status === 'label_created');
    if (anySucceeded) {
      const { data: recomputed } = await adminClient.rpc('recompute_shipment_status', { p_shipment_id: shipment_id });
      newStatus = recomputed as string | null;
    }

    return json({ success: true, shipment_status: newStatus || shipment.status, parcels: results });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Erreur inconnue' }, 500);
  }
});
