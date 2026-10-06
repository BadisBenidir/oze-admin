-- ============================================================================
-- Demande de livraison : garder la trace des articles retirés (0186) et
-- pouvoir les y remettre s'ils sont retrouvés.
--
-- order_items.removed_from_shipment_id : demande d'où l'article a été retiré
-- (posé par admin_return_requested_items_to_transit, effacé à la remise).
-- La fenêtre de la demande affiche ces articles tant qu'ils ne sont rattachés
-- à aucune autre demande, avec « Remettre dans la demande ».
-- ============================================================================

alter table public.order_items add column if not exists removed_from_shipment_id uuid references public.shipments (id) on delete set null;
create index if not exists order_items_removed_from_shipment_idx on public.order_items (removed_from_shipment_id) where removed_from_shipment_id is not null;

-- Rattrapage : articles déjà retirés via 0186 (retrouvés par la notification
-- envoyée au revendeur, qui porte la demande et les références).
update public.order_items oi
set removed_from_shipment_id = (n.payload->>'shipment_id')::uuid
from public.reseller_notifications n,
     jsonb_array_elements(n.payload->'items') it,
     public.products p
where n.type = 'delivery_request_cancelled'
  and n.message like 'Les articles suivants ne sont pas encore arrivés%'
  and p.id = oi.product_id
  and coalesce(p.b2b_reference, p.reference, p.product_code) = it->>'reference'
  and oi.fulfillment_status = 'ordered'
  and oi.shipment_id is null
  and oi.status = 'active'
  and oi.removed_from_shipment_id is null;

-- ----------------------------------------------------------------------------
-- 0186 : poser removed_from_shipment_id au retrait.
-- ----------------------------------------------------------------------------
create or replace function public.admin_return_requested_items_to_transit(p_item_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shipment record;
  v_items jsonb;
  v_item_ids uuid[];
  v_remaining int;
begin
  if not public.is_admin() then
    raise exception 'Accès refusé';
  end if;

  for v_shipment in
    select distinct s.id, s.reseller_id, s.requested_by_profile_id
    from public.order_items oi
    join public.shipments s on s.id = oi.shipment_id
    where oi.id = any(p_item_ids)
      and oi.fulfillment_status = 'delivery_requested'
      and oi.status = 'active'
  loop
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
      and oi.shipment_id = v_shipment.id
      and oi.fulfillment_status = 'delivery_requested'
      and oi.status = 'active';

    select count(*) into v_remaining
    from public.order_items
    where shipment_id = v_shipment.id
      and status = 'active'
      and not (id = any(v_item_ids));

    if v_remaining = 0 then
      raise exception 'C''est le dernier article de la demande : utilisez « Annuler la demande » (remboursement des frais de port possible)';
    end if;

    update public.order_items
    set fulfillment_status = 'ordered',
        received_at = null,
        ready_to_ship_at = null,
        delivery_requested_at = null,
        shipment_id = null,
        parcel_id = null,
        redelivery_notice_profile_id = v_shipment.requested_by_profile_id,
        removed_from_shipment_id = v_shipment.id
    where id = any(v_item_ids);

    perform public.recompute_shipment_status(v_shipment.id);

    if v_shipment.requested_by_profile_id is not null then
      insert into public.reseller_notifications (profile_id, reseller_id, type, title, message, payload)
      values (
        v_shipment.requested_by_profile_id,
        v_shipment.reseller_id,
        'delivery_request_cancelled',
        'Information sur votre demande de livraison',
        'Les articles suivants ne sont pas encore arrivés à notre atelier : ils ont été retirés de votre demande de livraison, le reste de la demande est expédié normalement. Vous serez notifié dès leur réception pour les faire livrer.',
        jsonb_build_object('shipment_id', v_shipment.id, 'items', v_items)
      );
    end if;
  end loop;

  return jsonb_build_object('updated_count', (
    select count(*) from public.order_items where id = any(p_item_ids) and fulfillment_status = 'ordered'
  ));
end;
$$;

-- ----------------------------------------------------------------------------
-- Remettre dans sa demande un article retiré puis retrouvé :
--   - la demande a déjà un bordereau pas encore remis au transporteur :
--     l'article rejoint CE colis (même bordereau, aucun nouveau colis) ;
--   - sinon : il redevient un article de la demande en attente d'étiquette.
-- La seconde notification « arrivé à l'atelier » est annulée, et le revendeur
-- est prévenu que l'article part avec sa demande.
-- ----------------------------------------------------------------------------
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
    if v_shipment.status not in ('requested', 'preparing') then
      raise exception 'Cette demande n''est plus modifiable (colis déjà remis au transporteur ou demande annulée)';
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

    -- Colis déjà étiqueté mais pas encore remis au transporteur.
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

notify pgrst, 'reload schema';
