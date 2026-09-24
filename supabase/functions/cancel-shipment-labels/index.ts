// Edge Function : cancel-shipment-labels
//
// Annule l'envoi d'une demande de livraison "En préparation" (bordereau
// Sendcloud généré, colis pas encore remis au transporteur) — RÉSERVÉ AUX
// ADMINS OZË (profiles.role='admin').
//
// 1. Annule chaque bordereau chez Sendcloud :
//    POST /api/v2/parcels/{id}/cancel (Basic Auth, même compte que
//    generate-b2b-shipment-labels). 200 = annulé, 202 = annulation en file
//    d'attente chez Sendcloud (acceptée), 410 = colis déjà supprimé chez
//    Sendcloud — les trois comptent comme annulés. Tout autre statut (ex.
//    400 : colis déjà pris en charge par le transporteur) = échec.
// 2. Appelle admin_cancel_shipment_parcels_core (0160) avec les SEULS colis
//    réellement annulés chez Sendcloud : leurs articles repassent "livraison
//    demandée" et la demande revient dans "En attente".
//
// Un bordereau qui n'a pas pu être annulé chez Sendcloud reste tel quel côté
// OZË (jamais de désynchronisation : on ne libère pas des articles dont
// l'étiquette serait encore valide chez le transporteur).
//
// Déploiement : `supabase functions deploy cancel-shipment-labels`

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const sendcloudPublicKey = Deno.env.get('SENDCLOUD_PUBLIC_KEY');
    const sendcloudSecretKey = Deno.env.get('SENDCLOUD_SECRET_KEY');
    if (!sendcloudPublicKey || !sendcloudSecretKey) {
      return json({ error: 'Clés Sendcloud manquantes dans les secrets Supabase' }, 500);
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

    const { shipment_id } = await req.json();
    if (!shipment_id) return json({ error: 'shipment_id est requis' }, 400);

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: parcels, error: parcelsError } = await adminClient
      .from('shipment_parcels')
      .select('id, parcel_index, status, sendcloud_parcel_id')
      .eq('shipment_id', shipment_id)
      .in('status', ['label_created', 'shipped', 'delivered']);
    if (parcelsError) return json({ error: parcelsError.message }, 500);

    const alreadyShipped = (parcels || []).filter((p) => p.status !== 'label_created');
    if (alreadyShipped.length > 0) {
      return json({
        error: `Impossible d'annuler : ${alreadyShipped.map((p) => `colis ${p.parcel_index}`).join(', ')} déjà pris en charge par le transporteur.`,
      }, 409);
    }
    const toCancel = (parcels || []).filter((p) => p.status === 'label_created');
    if (toCancel.length === 0) {
      return json({ error: 'Aucun bordereau à annuler sur cette demande' }, 400);
    }

    const auth = 'Basic ' + btoa(`${sendcloudPublicKey}:${sendcloudSecretKey}`);
    const cancelledIds: string[] = [];
    const failures: string[] = [];

    for (const parcel of toCancel) {
      if (!parcel.sendcloud_parcel_id) {
        failures.push(`Colis ${parcel.parcel_index} : aucun identifiant Sendcloud enregistré`);
        continue;
      }
      try {
        const res = await fetch(`https://panel.sendcloud.sc/api/v2/parcels/${encodeURIComponent(parcel.sendcloud_parcel_id)}/cancel`, {
          method: 'POST',
          headers: { Authorization: auth, 'Content-Type': 'application/json' },
        });
        const body = await res.json().catch(() => ({}));
        console.log('[Sendcloud] Annulation colis', { shipment_id, parcel_id: parcel.id, sendcloud_parcel_id: parcel.sendcloud_parcel_id, status: res.status, body });
        if (res.status === 200 || res.status === 202 || res.status === 410) {
          cancelledIds.push(parcel.id);
        } else {
          const message = (body as { message?: string; error?: { message?: string } })?.message
            || (body as { error?: { message?: string } })?.error?.message
            || `Erreur Sendcloud (${res.status})`;
          failures.push(`Colis ${parcel.parcel_index} : ${message}`);
        }
      } catch (err) {
        failures.push(`Colis ${parcel.parcel_index} : ${err instanceof Error ? err.message : 'erreur réseau'}`);
      }
    }

    if (cancelledIds.length === 0) {
      return json({ error: `Aucun bordereau n'a pu être annulé chez Sendcloud — ${failures.join(' · ')}` }, 400);
    }

    const { data: result, error: rpcError } = await adminClient.rpc('admin_cancel_shipment_parcels_core', {
      p_shipment_id: shipment_id,
      p_parcel_ids: cancelledIds,
    });
    if (rpcError) {
      return json({ error: `Bordereau(x) annulé(s) chez Sendcloud mais échec de la mise à jour OZË : ${rpcError.message}` }, 500);
    }

    return json({
      success: true,
      cancelled_parcels: result?.cancelled_parcels,
      item_count: result?.item_count,
      shipment_status: result?.shipment_status,
      failures: failures.length ? failures : undefined,
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Erreur inconnue' }, 500);
  }
});
