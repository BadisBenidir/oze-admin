-- ============================================================================
-- admin_add_item_to_shipment (0198) plus strict :
--   - même demandeur : la demande doit avoir été faite par la personne qui a
--     acheté l'article (un revendeur comme Aurel Vinted regroupe des dizaines
--     de membres, chacun avec sa propre adresse / son point relais) ;
--   - demande pas encore traitée : aucun bordereau généré (ni a fortiori de
--     colis parti) — une demande au statut 'requested' peut déjà avoir son
--     bordereau, et y ajouter un article fausserait poids et valeur assurée.
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
    where shipment_id = p_shipment_id and status in ('label_created', 'shipped', 'delivered')
  ) then
    raise exception 'Cette demande est déjà traitée (bordereau généré) : impossible d''y ajouter un article';
  end if;

  select oi.*, o.reseller_id, o.order_channel, o.placed_by_profile_id into v_item
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
  if v_item.reseller_id <> v_shipment.reseller_id
     or v_item.placed_by_profile_id is distinct from v_shipment.requested_by_profile_id then
    raise exception 'Cette demande de livraison a été faite par une autre personne que l''acheteur de l''article';
  end if;

  update public.order_items
  set shipment_id = p_shipment_id,
      received_at = coalesce(received_at, now()),
      ready_to_ship_at = coalesce(ready_to_ship_at, now()),
      fulfillment_status = 'delivery_requested'
  where id = p_item_id;

  v_new_status := public.recompute_shipment_status(p_shipment_id);

  return jsonb_build_object('shipment_id', p_shipment_id, 'attached_to_existing_label', false, 'shipment_status', v_new_status);
end;
$$;

revoke all on function public.admin_add_item_to_shipment(uuid, uuid) from public, anon;
grant execute on function public.admin_add_item_to_shipment(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
