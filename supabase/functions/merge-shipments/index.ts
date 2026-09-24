// Edge Function : merge-shipments
//
// Regroupe deux demandes de livraison d'un même revendeur dans un seul
// carton — RÉSERVÉ AUX ADMINS OZË (profiles.role='admin'). La demande
// source (source_id) est fusionnée dans la cible (target_id, dont l'adresse
// est conservée) :
//   1. les bordereaux encore actifs de la SOURCE sont annulés chez Sendcloud
//      (POST /api/v2/parcels/{id}/cancel, même règle que
//      cancel-shipment-labels : 200/202/410 = annulé) — si un seul échoue,
//      rien n'est regroupé ;
//   2. admin_merge_shipments_core (0163) déplace les articles vers la cible
//      (rattachés à son bordereau s'il en a exactement un) et clôt la source.
//
// Déploiement : `supabase functions deploy merge-shipments`

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

    const { target_id, source_id } = await req.json();
    if (!target_id || !source_id || target_id === source_id) {
      return json({ error: 'target_id et source_id (deux demandes différentes) sont requis' }, 400);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: shipments, error: shipmentsError } = await adminClient
      .from('shipments')
      .select('id, reseller_id, requested_by_profile_id, status')
      .in('id', [target_id, source_id]);
    if (shipmentsError) return json({ error: shipmentsError.message }, 500);
    const target = shipments?.find((s) => s.id === target_id);
    const source = shipments?.find((s) => s.id === source_id);
    if (!target || !source) return json({ error: 'Demande de livraison introuvable' }, 404);
    if (target.reseller_id !== source.reseller_id || !target.requested_by_profile_id || target.requested_by_profile_id !== source.requested_by_profile_id) {
      return json({ error: 'Les deux demandes doivent avoir été faites par la même personne' }, 400);
    }
    if (target.status !== 'requested' || source.status !== 'requested') {
      return json({ error: 'Seules deux demandes « En attente » peuvent être regroupées' }, 400);
    }

    const { data: parcels, error: parcelsError } = await adminClient
      .from('shipment_parcels')
      .select('id, shipment_id, parcel_index, status, sendcloud_parcel_id')
      .in('shipment_id', [target_id, source_id])
      .in('status', ['label_created', 'shipped', 'delivered']);
    if (parcelsError) return json({ error: parcelsError.message }, 500);
    if ((parcels || []).some((p) => p.status !== 'label_created')) {
      return json({ error: 'Un des colis est déjà chez le transporteur — regroupement impossible' }, 409);
    }

    // ---- 1. Annule chez Sendcloud les bordereaux de la source -------------
    const sourceParcels = (parcels || []).filter((p) => p.shipment_id === source_id);
    const cancelledIds: string[] = [];
    if (sourceParcels.length > 0) {
      const sendcloudPublicKey = Deno.env.get('SENDCLOUD_PUBLIC_KEY');
      const sendcloudSecretKey = Deno.env.get('SENDCLOUD_SECRET_KEY');
      if (!sendcloudPublicKey || !sendcloudSecretKey) {
        return json({ error: 'Clés Sendcloud manquantes dans les secrets Supabase' }, 500);
      }
      const auth = 'Basic ' + btoa(`${sendcloudPublicKey}:${sendcloudSecretKey}`);
      const failures: string[] = [];

      for (const parcel of sourceParcels) {
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
          console.log('[Sendcloud] Annulation colis (regroupement)', { source_id, target_id, sendcloud_parcel_id: parcel.sendcloud_parcel_id, status: res.status, body });
          if (res.status === 200 || res.status === 202 || res.status === 410) {
            cancelledIds.push(parcel.id);
          } else {
            const message = (body as { message?: string })?.message
              || (body as { error?: { message?: string } })?.error?.message
              || `Erreur Sendcloud (${res.status})`;
            failures.push(`Colis ${parcel.parcel_index} : ${message}`);
          }
        } catch (err) {
          failures.push(`Colis ${parcel.parcel_index} : ${err instanceof Error ? err.message : 'erreur réseau'}`);
        }
      }

      if (failures.length > 0) {
        // Les bordereaux déjà annulés chez Sendcloud sont quand même libérés
        // côté OZË (la demande source repasse "En attente"), mais on ne
        // regroupe pas : un bordereau encore valide resterait orphelin.
        if (cancelledIds.length > 0) {
          await adminClient.rpc('admin_cancel_shipment_parcels_core', { p_shipment_id: source_id, p_parcel_ids: cancelledIds });
        }
        return json({ error: `Regroupement annulé — bordereau(x) non annulé(s) chez Sendcloud : ${failures.join(' · ')}` }, 400);
      }
    }

    // ---- 2. Regroupement --------------------------------------------------
    const { data: result, error: rpcError } = await adminClient.rpc('admin_merge_shipments_core', {
      p_target_id: target_id,
      p_source_id: source_id,
      p_cancelled_parcel_ids: cancelledIds,
    });
    if (rpcError) {
      if (cancelledIds.length > 0) {
        await adminClient.rpc('admin_cancel_shipment_parcels_core', { p_shipment_id: source_id, p_parcel_ids: cancelledIds });
      }
      return json({ error: rpcError.message }, 400);
    }

    return json({
      success: true,
      moved_items: result?.moved_items,
      attached_to_existing_label: result?.attached_to_existing_label,
      cancelled_labels: cancelledIds.length,
      target_status: result?.target_status,
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Erreur inconnue' }, 500);
  }
});
