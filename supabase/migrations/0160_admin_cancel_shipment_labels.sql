-- ============================================================================
-- Annulation de l'envoi d'une demande "En préparation" (étiquette Sendcloud
-- générée mais colis pas encore remis au transporteur) — ADMIN UNIQUEMENT.
--
-- L'Edge Function cancel-shipment-labels annule d'abord chaque bordereau chez
-- Sendcloud, puis appelle cette fonction avec les colis RÉELLEMENT annulés
-- là-bas : leurs articles repassent 'delivery_requested' (la demande revient
-- dans "En attente", prête pour une nouvelle étiquette) et les colis sont
-- supprimés — la trace reste côté Sendcloud, et la numérotation du prochain
-- bordereau repart de "Colis 1" (voir generate-b2b-shipment-labels).
--
-- Seuls les colis 'label_created' sont concernés : un colis 'shipped' est
-- déjà chez le transporteur, Sendcloud refuse alors l'annulation.
-- ============================================================================

create or replace function public.admin_cancel_shipment_parcels_core(
  p_shipment_id uuid,
  p_parcel_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parcel_ids uuid[];
  v_item_count int;
  v_new_status text;
begin
  perform 1 from public.shipments where id = p_shipment_id for update;
  if not found then
    raise exception 'Demande de livraison introuvable';
  end if;

  select array_agg(id) into v_parcel_ids
  from public.shipment_parcels
  where shipment_id = p_shipment_id and id = any(p_parcel_ids) and status = 'label_created';

  if v_parcel_ids is null then
    raise exception 'Aucun bordereau annulable sur cette demande';
  end if;

  update public.order_items
  set fulfillment_status = 'delivery_requested',
      parcel_id = null,
      label_created_at = null
  where parcel_id = any(v_parcel_ids) and fulfillment_status = 'label_created';
  get diagnostics v_item_count = row_count;

  delete from public.shipment_parcels where id = any(v_parcel_ids);

  v_new_status := public.recompute_shipment_status(p_shipment_id);

  return jsonb_build_object(
    'shipment_id', p_shipment_id,
    'cancelled_parcels', array_length(v_parcel_ids, 1),
    'item_count', v_item_count,
    'shipment_status', v_new_status
  );
end;
$$;

revoke all on function public.admin_cancel_shipment_parcels_core(uuid, uuid[]) from public, anon, authenticated;

notify pgrst, 'reload schema';
