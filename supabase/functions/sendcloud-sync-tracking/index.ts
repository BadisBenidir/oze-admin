// Edge Function : sendcloud-sync-tracking
//
// Synchronisation MANUELLE des statuts réels de colis auprès de Sendcloud —
// filet de secours tant que sendcloud-webhook n'est pas configuré côté
// dashboard Sendcloud (ou en complément, au cas où un événement webhook
// aurait été manqué).
//
// Utilise GET /api/v2/parcels?tracking_number=... (Basic Auth), confirmé par
// https://sendcloud.dev/api/v2/parcels/retrieve-parcels — réponse
// { parcels: [{ id, tracking_number, status: { id, message }, ... }] }.
// PAS la v3 /parcels/tracking/{tracking_number} utilisée dans une version
// précédente de ce fichier : cette dernière renvoie un tableau `events[]`
// dont chaque entrée a son propre status_code/status_description (rien à la
// racine) — un bug de lecture y avait fait rester des colis livrés bloqués
// sur "En préparation" sans jamais logguer d'erreur, ce qui masquait le
// problème. Le v2 ci-dessous a un format plat, plus simple à vérifier.
//
// Réservé aux admins OZË. Appelable pour UN shipment précis (bouton
// "Actualiser les statuts Sendcloud" dans une demande de livraison, une
// commande, ou la fiche produit) ou sans argument (balaie un lot borné de
// colis non finalisés).
//
// Déploiement : `supabase functions deploy sendcloud-sync-tracking`

import { createClient } from 'npm:@supabase/supabase-js@2';

const LOG_PREFIX = '[sendcloud-sync-tracking]';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const MAX_PARCELS_PER_RUN = 50;

// Mots-clés en repli du code numérique (id === 11 = "Delivered", convention
// Sendcloud v2 de longue date mais non retrouvée verbatim dans la doc
// actuelle) : si jamais l'id diffère de ce qu'on attend, le message texte
// reste une deuxième chance de classer correctement plutôt que de rater
// silencieusement l'événement.
function classifySendcloudStatus(statusId: number | null, message: string | null | undefined): 'label_created' | 'shipped' | 'delivered' | null {
  const m = (message || '').toLowerCase();
  if (statusId === 11 || /(delivered|livr[ée]|remis au destinataire|collected by (the )?(consignee|recipient|customer))/.test(m)) {
    return 'delivered';
  }
  if (/(in transit|en route|transit|collected|picked ?up|sorting|hub|customs|dispatch(ed)?|forwarded|out for delivery|arrived at|handed over)/.test(m)) {
    return 'shipped';
  }
  return null;
}

Deno.serve(async (req: Request) => {
  console.log(`${LOG_PREFIX} invoked, method=${req.method}`);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const rawBody = await req.clone().text();
  console.log(`${LOG_PREFIX} raw body:`, rawBody);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const sendcloudPublicKey = Deno.env.get('SENDCLOUD_PUBLIC_KEY');
    const sendcloudSecretKey = Deno.env.get('SENDCLOUD_SECRET_KEY');

    console.log(`${LOG_PREFIX} secrets present — SENDCLOUD_PUBLIC_KEY: ${!!sendcloudPublicKey}, SENDCLOUD_SECRET_KEY: ${!!sendcloudSecretKey}`);
    if (!sendcloudPublicKey || !sendcloudSecretKey) {
      console.error(`${LOG_PREFIX} Clés Sendcloud manquantes côté serveur (secrets Supabase du projet)`);
      return json({ error: 'Clés Sendcloud manquantes côté serveur (SENDCLOUD_PUBLIC_KEY / SENDCLOUD_SECRET_KEY)' }, 500);
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      console.error(`${LOG_PREFIX} Requête sans header Authorization`);
      return json({ error: 'Non authentifié' }, 401);
    }

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await callerClient.auth.getUser();
    if (userError || !user) {
      console.error(`${LOG_PREFIX} Échec auth.getUser:`, userError?.message);
      return json({ error: 'Non authentifié' }, 401);
    }

    const { data: callerProfile } = await callerClient
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();
    if (callerProfile?.role !== 'admin') {
      console.error(`${LOG_PREFIX} Utilisateur ${user.id} n'est pas admin (role=${callerProfile?.role})`);
      return json({ error: 'Action réservée aux administrateurs' }, 403);
    }

    let bodyJson: Record<string, unknown> = {};
    try {
      bodyJson = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      console.error(`${LOG_PREFIX} Corps non-JSON reçu`);
    }
    const shipmentId: string | undefined = bodyJson?.shipment_id as string | undefined;
    console.log(`${LOG_PREFIX} admin=${user.id}, shipment_id=${shipmentId ?? '(tous)'}`);

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    let query = adminClient
      .from('shipment_parcels')
      .select('id, shipment_id, sendcloud_parcel_id, tracking_number, status')
      .in('status', ['label_created', 'shipped'])
      .not('tracking_number', 'is', null)
      .order('updated_at', { ascending: true })
      .limit(MAX_PARCELS_PER_RUN);
    if (shipmentId) query = query.eq('shipment_id', shipmentId);

    const { data: parcels, error: parcelsError } = await query;
    if (parcelsError) {
      console.error(`${LOG_PREFIX} Échec lecture shipment_parcels:`, parcelsError.message);
      return json({ error: parcelsError.message }, 500);
    }

    console.log(`${LOG_PREFIX} ${parcels?.length || 0} colis à vérifier`);

    const authHeaderValue = 'Basic ' + btoa(`${sendcloudPublicKey}:${sendcloudSecretKey}`);
    let checked = 0;
    let updated = 0;
    const errors: Array<{ tracking_number: string; error: string }> = [];
    const results: Array<{ tracking_number: string; new_status: string | null }> = [];
    const shipmentIdsTouched = new Set<string>();

    for (const parcel of parcels || []) {
      checked++;
      try {
        const url = `https://panel.sendcloud.sc/api/v2/parcels?tracking_number=${encodeURIComponent(parcel.tracking_number)}`;
        const res = await fetch(url, { headers: { Authorization: authHeaderValue } });
        const rawResponseText = await res.text();
        console.log(`${LOG_PREFIX} GET ${url} -> ${res.status}: ${rawResponseText.slice(0, 1000)}`);

        let data: Record<string, unknown> = {};
        try {
          data = rawResponseText ? JSON.parse(rawResponseText) : {};
        } catch {
          console.error(`${LOG_PREFIX} Réponse non-JSON de Sendcloud pour ${parcel.tracking_number}`);
        }

        if (!res.ok) {
          errors.push({ tracking_number: parcel.tracking_number, error: data?.message || `Erreur Sendcloud (${res.status})` });
          continue;
        }

        const sendcloudParcel = Array.isArray(data?.parcels) ? data.parcels[0] : null;
        if (!sendcloudParcel) {
          console.error(`${LOG_PREFIX} Aucun colis Sendcloud trouvé pour tracking_number=${parcel.tracking_number}`);
          errors.push({ tracking_number: parcel.tracking_number, error: 'Colis introuvable côté Sendcloud pour ce numéro de suivi' });
          continue;
        }

        const statusId: number | null = sendcloudParcel.status?.id ?? null;
        const statusMessage: string | null = sendcloudParcel.status?.message ?? null;
        const classified = classifySendcloudStatus(statusId, statusMessage);
        console.log(`${LOG_PREFIX} tracking_number=${parcel.tracking_number} status.id=${statusId} status.message="${statusMessage}" -> classifié: ${classified ?? '(non reconnu)'}`);

        results.push({ tracking_number: parcel.tracking_number, new_status: classified });

        const { data: applyResult, error: applyError } = await adminClient.rpc('apply_sendcloud_parcel_status', {
          p_sendcloud_parcel_id: parcel.sendcloud_parcel_id,
          p_new_status: classified,
          p_carrier_status_code: statusId != null ? String(statusId) : null,
          p_carrier_status_message: statusMessage,
          p_tracking_number: parcel.tracking_number,
        });
        if (applyError) {
          console.error(`${LOG_PREFIX} Échec apply_sendcloud_parcel_status pour ${parcel.tracking_number}:`, applyError.message);
          errors.push({ tracking_number: parcel.tracking_number, error: applyError.message });
          continue;
        }
        if (applyResult?.found) {
          updated++;
          shipmentIdsTouched.add(parcel.shipment_id);
          console.log(`${LOG_PREFIX} shipment ${parcel.shipment_id} -> ${applyResult.shipment_status}`);
        } else {
          console.error(`${LOG_PREFIX} apply_sendcloud_parcel_status n'a trouvé aucun shipment_parcels pour ${parcel.tracking_number} (sendcloud_parcel_id=${parcel.sendcloud_parcel_id})`);
        }
      } catch (err) {
        console.error(`${LOG_PREFIX} Exception pour ${parcel.tracking_number}:`, err instanceof Error ? err.stack || err.message : err);
        errors.push({ tracking_number: parcel.tracking_number, error: err instanceof Error ? err.message : 'Erreur réseau' });
      }
    }

    console.log(`${LOG_PREFIX} terminé — checked=${checked} updated=${updated} errors=${errors.length}`);
    return json({ success: true, checked, updated, errors, results, shipment_ids: [...shipmentIdsTouched] });
  } catch (err) {
    console.error(`${LOG_PREFIX} Erreur non gérée:`, err instanceof Error ? err.stack || err.message : err);
    return json({ error: err instanceof Error ? err.message : 'Erreur inconnue' }, 500);
  }
});
