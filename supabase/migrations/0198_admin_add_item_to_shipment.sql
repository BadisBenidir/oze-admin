-- ============================================================================
-- Ajout d'un article oublié à une demande de livraison déjà faite.
--
-- Cas réel : un article n'avait pas été passé « prêt à la livraison » à
-- temps, le membre a demandé (et payé) la livraison de ses autres articles
-- sans lui. Plutôt que de lui faire refaire une demande (et repayer le
-- port), l'admin rattache l'article à la demande en cours depuis la fiche
-- produit. Mêmes règles que la fusion de demandes (admin_merge_shipments_
-- core, 0163) : demande « En attente » (requested) d'un même revendeur, aucun
-- colis déjà chez le transporteur ; si la demande a exactement un bordereau
-- actif, l'article y est rattaché (comme une fusion), sinon il part avec la
-- génération du bordereau.
-- ============================================================================

create or replace function public.admin_add_item_to_shipment(p_item_id uuid, p_shipment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shipment record;
  v_item record;
  v_parcel uuid;
  v_real_parcels int;
  v_new_status text;
begin
  if not public.is_admin() then
    raise exception 'Accès refusé : réservé aux administrateurs';
  end if;

  select * into v_shipment from public.shipments where id = p_shipment_id for update;
  if not found then
    raise exception 'Demande de livraison introuvable';
  end if;
  if v_shipment.status <> 'requested' then
    raise exception 'Seule une demande de livraison « En attente » peut recevoir un article';
  end if;
  if exists (
    select 1 from public.shipment_parcels
    where shipment_id = p_shipment_id and status in ('shipped', 'delivered')
  ) then
    raise exception 'Un colis de cette demande est déjà chez le transporteur';
  end if;

  select oi.*, o.reseller_id, o.order_channel into v_item
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where oi.id = p_item_id
  for update of oi;
  if not found then
    raise exception 'Article introuvable';
  end if;
  if v_item.status <> 'active' or v_item.order_channel <> 'b2b' then
    raise exception 'Article annulé ou hors B2B';
  end if;
  if v_item.shipment_id is not null then
    raise exception 'Cet article fait déjà partie d''une demande de livraison';
  end if;
  if v_item.fulfillment_status not in ('ordered', 'received', 'ready_to_ship') then
    raise exception 'Cet article est déjà en cours d''expédition';
  end if;
  if v_item.reseller_id <> v_shipment.reseller_id then
    raise exception 'Cette demande de livraison appartient à un autre revendeur';
  end if;

  select count(*), min(id::text)::uuid into v_real_parcels, v_parcel
  from public.shipment_parcels
  where shipment_id = p_shipment_id and status = 'label_created';

  update public.order_items
  set shipment_id = p_shipment_id,
      received_at = coalesce(received_at, now()),
      ready_to_ship_at = coalesce(ready_to_ship_at, now()),
      fulfillment_status = case when v_real_parcels = 1 then 'label_created' else 'delivery_requested' end,
      parcel_id = case when v_real_parcels = 1 then v_parcel else null end,
      label_created_at = case when v_real_parcels = 1 then now() else label_created_at end
  where id = p_item_id;

  v_new_status := public.recompute_shipment_status(p_shipment_id);

  return jsonb_build_object(
    'shipment_id', p_shipment_id,
    'attached_to_existing_label', v_real_parcels = 1,
    'shipment_status', v_new_status
  );
end;
$$;

revoke all on function public.admin_add_item_to_shipment(uuid, uuid) from public, anon;
grant execute on function public.admin_add_item_to_shipment(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
