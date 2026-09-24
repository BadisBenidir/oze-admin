-- ============================================================================
-- Regrouper deux demandes de livraison d'un même revendeur dans un seul
-- carton — ADMIN UNIQUEMENT, via l'Edge Function merge-shipments.
--
-- La demande "source" est fusionnée dans la demande "cible" (celle ouverte
-- par l'admin, dont l'adresse de livraison est conservée) :
--   - l'Edge Function a déjà annulé chez Sendcloud les bordereaux de la
--     source (p_cancelled_parcel_ids) — supprimés ici ;
--   - les articles de la source rejoignent la cible. Si la cible a
--     exactement UN colis étiqueté (pas encore remis au transporteur), ils
--     sont rattachés à ce colis : le bordereau de la cible est conservé, un
--     seul carton part avec. Sinon ils y attendent une étiquette ;
--   - la source passe en 'cancelled' avec merged_into_shipment_id (trace du
--     paiement de ses frais de port conservée, aucun remboursement auto).
-- ============================================================================

alter table public.shipments add column if not exists merged_into_shipment_id uuid references public.shipments (id);

create or replace function public.admin_merge_shipments_core(
  p_target_id uuid,
  p_source_id uuid,
  p_cancelled_parcel_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target record;
  v_source record;
  v_target_parcel uuid;
  v_target_real_parcels int;
  v_moved int;
  v_new_status text;
begin
  if p_target_id = p_source_id then
    raise exception 'Impossible de regrouper une demande avec elle-même';
  end if;

  -- Verrouillage dans un ordre stable pour éviter tout interblocage.
  perform 1 from public.shipments where id in (p_target_id, p_source_id) order by id for update;

  select * into v_target from public.shipments where id = p_target_id;
  select * into v_source from public.shipments where id = p_source_id;
  if v_target.id is null or v_source.id is null then
    raise exception 'Demande de livraison introuvable';
  end if;
  if v_target.reseller_id <> v_source.reseller_id then
    raise exception 'Les deux demandes doivent appartenir au même revendeur';
  end if;
  if v_target.status not in ('requested', 'preparing') or v_source.status not in ('requested', 'preparing') then
    raise exception 'Seules les demandes en attente ou en préparation peuvent être regroupées';
  end if;
  if exists (
    select 1 from public.shipment_parcels
    where shipment_id in (p_target_id, p_source_id) and status in ('shipped', 'delivered')
  ) then
    raise exception 'Un des colis est déjà chez le transporteur — regroupement impossible';
  end if;

  -- Bordereaux de la source annulés chez Sendcloud : leurs articles
  -- redeviennent "livraison demandée" avant d'être déplacés.
  if p_cancelled_parcel_ids is not null and array_length(p_cancelled_parcel_ids, 1) > 0 then
    update public.order_items
    set fulfillment_status = 'delivery_requested', parcel_id = null, label_created_at = null
    where parcel_id = any(p_cancelled_parcel_ids);
    delete from public.shipment_parcels where id = any(p_cancelled_parcel_ids) and shipment_id = p_source_id;
  end if;

  if exists (
    select 1 from public.shipment_parcels
    where shipment_id = p_source_id and status = 'label_created'
  ) then
    raise exception 'La demande à regrouper a encore un bordereau actif chez Sendcloud';
  end if;

  select count(*), min(id::text)::uuid into v_target_real_parcels, v_target_parcel
  from public.shipment_parcels
  where shipment_id = p_target_id and status = 'label_created';

  if v_target_real_parcels = 1 then
    update public.order_items
    set shipment_id = p_target_id,
        fulfillment_status = 'label_created',
        parcel_id = v_target_parcel,
        label_created_at = now()
    where shipment_id = p_source_id and status = 'active' and fulfillment_status = 'delivery_requested';
  else
    update public.order_items
    set shipment_id = p_target_id
    where shipment_id = p_source_id and status = 'active' and fulfillment_status = 'delivery_requested';
  end if;
  get diagnostics v_moved = row_count;

  delete from public.shipment_parcels where shipment_id = p_source_id and status in ('pending', 'failed');

  update public.shipments
  set status = 'cancelled',
      cancelled_at = now(),
      cancellation_reason = 'Regroupée avec une autre demande de livraison',
      merged_into_shipment_id = p_target_id,
      shipping_refund_status = 'not_applicable',
      updated_at = now()
  where id = p_source_id;

  v_new_status := public.recompute_shipment_status(p_target_id);

  return jsonb_build_object(
    'target_id', p_target_id,
    'moved_items', v_moved,
    'attached_to_existing_label', v_target_real_parcels = 1,
    'target_status', v_new_status
  );
end;
$$;

revoke all on function public.admin_merge_shipments_core(uuid, uuid, uuid[]) from public, anon, authenticated;

notify pgrst, 'reload schema';
