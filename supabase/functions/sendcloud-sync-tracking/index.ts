// Edge Function : sendcloud-sync-tracking
//
// Synchronisation MANUELLE des statuts réels de colis auprès de Sendcloud —
// filet de secours tant que sendcloud-webhook n'est pas configuré côté
// dashboard Sendcloud (ou en complément, au cas où un événement webhook
// aurait été manqué). Utilise l'endpoint documenté et confirmé
// GET /parcels/tracking/{tracking_number} (v3), voir
// https://sendcloud.dev/api/v3/parcel-tracking/retrieve-tracking-information-for-a-parcel
// — contrairement au webhook, dont la forme exacte du payload n'a pas pu
// être vérifiée avant écriture (voir sendcloud-webhook/index.ts).
//
// Réservé aux admins OZË. Appelable pour UN shipment précis (bouton
// "Actualiser les statuts Sendcloud" dans une demande de livraison) ou sans
// argument (balaie un lot borné de colis non finalisés, pour un usage cron
// futur si souhaité).
//
// Déploiement : `supabase functions deploy sendcloud-sync-tracking`

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const MAX_PARCELS_PER_RUN = 50;

// Classification par mots-clés plutôt que par code numérique Sendcloud : la
// liste exhaustive des status_code n'est pas publiquement documentée de
// façon fiable (voir sendcloud.dev/api/v3/parcel-statuses) — le
// status_description texte, lui, est stable et suffisant pour distinguer nos
// 3 paliers. Copie identique dans sendcloud-webhook/index.ts.
function classifySendcloudStatus(description: string | null | undefined): 'label_created' | 'shipped' | 'delivered' | null {
  const d = (description || '').toLowerCase();
  if (!d) return null;
  // Mots-clés forts uniquement : "disponible en point relais" / "arrivé au
  // point de retrait" ne compte PAS comme livré — le destinataire n'a pas
  // encore récupéré le colis, seulement une vraie remise/collecte confirmée.
  if (/(delivered|livr[ée]|remis au destinataire|collected by (the )?(consignee|recipient|customer))/.test(d)) {
    return 'delivered';
  }
  if (/(in transit|en route|transit|collected|picked ?up|sorting|hub|customs|dispatch(ed)?|forwarded|out for delivery|arrived at|handed over)/.test(d)) {
    return 'shipped';
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const sendcloudPublicKey = Deno.env.get('SENDCLOUD_PUBLIC_KEY');
    const sendcloudSecretKey = Deno.env.get('SENDCLOUD_SECRET_KEY');
    if (!sendcloudPublicKey || !sendcloudSecretKey) {
      return json({ error: 'Clés Sendcloud manquantes côté serveur' }, 500);
    }

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

    const body = await req.json().catch(() => ({}));
    const shipmentId: string | undefined = body?.shipment_id;

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
    if (parcelsError) return json({ error: parcelsError.message }, 500);

    const authHeaderValue = 'Basic ' + btoa(`${sendcloudPublicKey}:${sendcloudSecretKey}`);
    let checked = 0;
    let updated = 0;
    const errors: Array<{ tracking_number: string; error: string }> = [];
    const shipmentIdsTouched = new Set<string>();

    for (const parcel of parcels || []) {
      checked++;
      try {
        const res = await fetch(
          `https://panel.sendcloud.sc/api/v3/parcels/tracking/${encodeURIComponent(parcel.tracking_number)}`,
          { headers: { Authorization: authHeaderValue } }
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          errors.push({ tracking_number: parcel.tracking_number, error: data?.message || `Erreur Sendcloud (${res.status})` });
          continue;
        }

        const statusCode: string | null = data?.status_code != null ? String(data.status_code) : null;
        const statusDescription: string | null = data?.status_description || null;
        const classified = classifySendcloudStatus(statusDescription);

        if (!parcel.sendcloud_parcel_id) continue;

        const { data: applyResult, error: applyError } = await adminClient.rpc('apply_sendcloud_parcel_status', {
          p_sendcloud_parcel_id: parcel.sendcloud_parcel_id,
          p_new_status: classified,
          p_carrier_status_code: statusCode,
          p_carrier_status_message: statusDescription,
        });
        if (applyError) {
          errors.push({ tracking_number: parcel.tracking_number, error: applyError.message });
          continue;
        }
        if (applyResult?.found) {
          updated++;
          shipmentIdsTouched.add(parcel.shipment_id);
        }
      } catch (err) {
        errors.push({ tracking_number: parcel.tracking_number, error: err instanceof Error ? err.message : 'Erreur réseau' });
      }
    }

    return json({ success: true, checked, updated, errors, shipment_ids: [...shipmentIdsTouched] });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Erreur inconnue' }, 500);
  }
});
