-- ============================================================================
-- Demande de livraison : un article sorti d'un colis reste rattaché à sa
-- demande (port déjà payé) et peut y être remis à tout moment, sans nouveau
-- paiement, même si une partie de la demande est déjà expédiée ou livrée.
--
--   1. admin_revert_item_to_received (« Annuler cette préparation ») garde
--      la demande d'origine dans removed_from_shipment_id (comme 0246) :
--      l'article reste visible dans la fenêtre de la demande.
--   2. admin_restore_items_to_shipment : autorisé sur toute demande non
--      annulée (avant : seulement « En attente » / « En préparation »).
--      S'il existe un bordereau généré mais pas encore remis au transporteur,
--      l'article le rejoint ; sinon il repasse en attente d'étiquette et
--      l'admin génère un nouveau bordereau (aucun frais pour le revendeur).
--   3. admin_add_item_to_shipment : même règle pour un autre article prêt du
--      même acheteur.
-- ============================================================================

-- 1. ------------------------------------------------------------------------
create or replace function public.admin_revert_item_to_received(p_item_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated_ids uuid[];
  v_affected_shipment_ids uuid[];
  v_shipment_id uuid;
  v_remaining_count int;
  v_has_real_parcels boolean;
begin
  if not public.is_admin() then
    raise exception 'Accès refusé';
  end if;

  select array_agg(distinct shipment_id) into v_affected_shipment_ids
  from public.order_items
  where id = any(p_item_ids)
    and fulfillment_status in ('delivery_requested', 'label_created')
    and shipment_id is not null;

  with updated as (
    update public.order_items oi
    set fulfillment_status = 'received',
        ready_to_ship_at = null,
        delivery_requested_at = null,
        label_created_at = null,
        shipped_at = null,
        delivered_at = null,
        removed_from_shipment_id = coalesce(oi.shipment_id, oi.removed_from_shipment_id),
        shipment_id = null,
        parcel_id = null
    from public.orders o
    where oi.order_id = o.id
      and oi.id = any(p_item_ids)
      and oi.fulfillment_status in ('ready_to_ship', 'delivery_requested', 'label_created')
      and oi.status = 'active'
      and o.order_channel = 'b2b'
    returning oi.id
  )
  select array_agg(id) into v_updated_ids from updated;

  if v_affected_shipment_ids is not null then
    foreach v_shipment_id in array v_affected_shipment_ids loop
      select count(*) into v_remaining_count from public.order_items where shipment_id = v_shipment_id;

      if v_remaining_count = 0 then
        select exists(
          select 1 from public.shipment_parcels where shipment_id = v_shipment_id and status in ('label_created', 'shipped', 'delivered')
        ) into v_has_real_parcels;

        if v_has_real_parcels then
          perform public.recompute_shipment_status(v_shipment_id);
        else
          update public.order_items set removed_from_shipment_id = null where removed_from_shipment_id = v_shipment_id;
          delete from public.shipment_parcels where shipment_id = v_shipment_id;
          delete from public.shipments where id = v_shipment_id;
        end if;
      else
        perform public.recompute_shipment_status(v_shipment_id);
      end if;
    end loop;
  end if;

  return jsonb_build_object(
    'updated_ids', to_jsonb(coalesce(v_updated_ids, array[]::uuid[])),
    'updated_count', coalesce(array_length(v_updated_ids, 1), 0)
  );
end;
$$;

grant execute on function public.admin_revert_item_to_received(uuid[]) to authenticated;

-- 2. ------------------------------------------------------------------------
create or replace function public.admin_restore_items_to_shipment(p_item_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shipment record;
  v_items jsonb;
  v_item_ids uuid[];
  v_parcel_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Accès refusé';
  end if;

  for v_shipment in
    select distinct s.id, s.status, s.reseller_id, s.requested_by_profile_id
    from public.order_items oi
    join public.shipments s on s.id = oi.removed_from_shipment_id
    where oi.id = any(p_item_ids)
  loop
    if v_shipment.status = 'cancelled' then
      raise exception 'Cette demande a été annulée : impossible d''y remettre un article';
    end if;

    select
      coalesce(jsonb_agg(jsonb_build_object(
        'reference', coalesce(p.b2b_reference, p.reference, p.product_code, oi.product_snapshot->>'reference', oi.product_snapshot->>'product_code', '—'),
        'name', coalesce(p.name, oi.product_snapshot->>'name', 'Article')
      ) order by oi.id), '[]'::jsonb),
      array_agg(oi.id)
    into v_items, v_item_ids
    from public.order_items oi
    left join public.products p on p.id = oi.product_id
    where oi.id = any(p_item_ids)
      and oi.removed_from_shipment_id = v_shipment.id
      and oi.shipment_id is null
      and oi.status = 'active'
      and oi.fulfillment_status in ('ordered', 'received', 'ready_to_ship');

    if v_item_ids is null then
      continue;
    end if;

    -- Bordereau déjà généré mais pas encore remis au transporteur.
    select id into v_parcel_id
    from public.shipment_parcels
    where shipment_id = v_shipment.id and status = 'label_created'
    order by parcel_index
    limit 1;

    update public.order_items
    set fulfillment_status = case when v_parcel_id is not null then 'label_created' else 'delivery_requested' end,
        received_at = coalesce(received_at, now()),
        ready_to_ship_at = coalesce(ready_to_ship_at, now()),
        delivery_requested_at = now(),
        label_created_at = case when v_parcel_id is not null then now() else null end,
        shipped_at = null,
        delivered_at = null,
        shipment_id = v_shipment.id,
        parcel_id = v_parcel_id,
        redelivery_notice_profile_id = null,
        removed_from_shipment_id = null
    where id = any(v_item_ids);

    perform public.recompute_shipment_status(v_shipment.id);

    if v_shipment.requested_by_profile_id is not null then
      insert into public.reseller_notifications (profile_id, reseller_id, type, title, message, payload)
      values (
        v_shipment.requested_by_profile_id,
        v_shipment.reseller_id,
        'redelivery_ready',
        'Bonne nouvelle pour votre demande de livraison',
        'Les articles suivants ont finalement bien été réceptionnés : ils ont été remis dans votre demande de livraison et seront expédiés avec elle.',
        jsonb_build_object('shipment_id', v_shipment.id, 'items', v_items)
      );
    end if;
  end loop;

  return jsonb_build_object('updated_count', (
    select count(*) from public.order_items where id = any(p_item_ids) and fulfillment_status in ('delivery_requested', 'label_created')
  ));
end;
$$;

revoke all on function public.admin_restore_items_to_shipment(uuid[]) from public, anon;
grant execute on function public.admin_restore_items_to_shipment(uuid[]) to authenticated;

-- 3. ------------------------------------------------------------------------
create or replace function public.admin_add_item_to_shipment(p_item_id uuid, p_shipment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shipment record;
  v_item record;
  v_parcel_id uuid;
  v_new_status text;
begin
  if not public.is_admin() then
    raise exception 'Accès refusé : réservé aux administrateurs';
  end if;

  select * into v_shipment from public.shipments where id = p_shipment_id for update;
  if not found then
    raise exception 'Demande de livraison introuvable';
  end if;
  if v_shipment.status = 'cancelled' then
    raise exception 'Cette demande a été annulée : impossible d''y ajouter un article';
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

  -- Bordereau déjà généré mais pas encore remis au transporteur : l'article le rejoint.
  select id into v_parcel_id
  from public.shipment_parcels
  where shipment_id = p_shipment_id and status = 'label_created'
  order by parcel_index
  limit 1;

  update public.order_items
  set shipment_id = p_shipment_id,
      parcel_id = v_parcel_id,
      received_at = coalesce(received_at, now()),
      ready_to_ship_at = coalesce(ready_to_ship_at, now()),
      delivery_requested_at = coalesce(delivery_requested_at, now()),
      label_created_at = case when v_parcel_id is not null then now() else null end,
      removed_from_shipment_id = null,
      fulfillment_status = case when v_parcel_id is not null then 'label_created' else 'delivery_requested' end
  where id = p_item_id;

  v_new_status := public.recompute_shipment_status(p_shipment_id);

  return jsonb_build_object('shipment_id', p_shipment_id, 'attached_to_existing_label', v_parcel_id is not null, 'shipment_status', v_new_status);
end;
$$;

revoke all on function public.admin_add_item_to_shipment(uuid, uuid) from public, anon;
grant execute on function public.admin_add_item_to_shipment(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
