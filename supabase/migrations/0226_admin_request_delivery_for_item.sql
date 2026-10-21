-- ============================================================================
-- Admin : remettre un article B2B en « livraison demandée ».
--
-- Cas réel : un article d'une commande expédiée en partie n'est jamais parti
-- (resté « prêt à expédier », sans demande de livraison). L'admin crée pour
-- l'ACHETEUR une nouvelle demande de livraison (frais de port 0 €) vers la même
-- destination que sa dernière demande (type, point relais, instructions) —
-- sinon ses préférences de livraison du profil, sinon à domicile. La demande
-- apparaît ensuite dans « Demandes de livraison › En attente » comme les autres.
-- Si l'acheteur a déjà une demande en attente sans bordereau, l'article y est
-- simplement ajouté (même règle que admin_add_item_to_shipment, 0199).
-- ============================================================================

create or replace function public.admin_request_delivery_for_item(p_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item record;
  v_last record;
  v_profile record;
  v_pending uuid;
  v_shipment_id uuid;
  v_delivery_type text;
  v_parcel_point jsonb;
  v_instructions text;
  v_new_status text;
begin
  if not public.is_admin() then
    raise exception 'Accès refusé : réservé aux administrateurs';
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
  if v_item.placed_by_profile_id is null then
    raise exception 'Acheteur introuvable pour cet article';
  end if;

  -- Demande en attente de ce même acheteur, sans bordereau : on y ajoute l'article.
  select s.id into v_pending
  from public.shipments s
  where s.requested_by_profile_id = v_item.placed_by_profile_id
    and s.reseller_id = v_item.reseller_id
    and s.status = 'requested'
    and not exists (
      select 1 from public.shipment_parcels sp
      where sp.shipment_id = s.id and sp.status in ('label_created', 'shipped', 'delivered')
    )
  order by s.created_at desc
  limit 1;

  if v_pending is not null then
    v_shipment_id := v_pending;
  else
    -- Destination : dernière demande de l'acheteur, sinon préférences du profil.
    select delivery_type, parcel_point, delivery_instructions into v_last
    from public.shipments
    where requested_by_profile_id = v_item.placed_by_profile_id and cancelled_at is null
    order by created_at desc
    limit 1;

    if v_last.delivery_type is not null then
      v_delivery_type := v_last.delivery_type;
      v_parcel_point := v_last.parcel_point;
      v_instructions := v_last.delivery_instructions;
    else
      select default_delivery_type, default_relay_point, delivery_instructions into v_profile
      from public.profiles where id = v_item.placed_by_profile_id;
      v_delivery_type := coalesce(v_profile.default_delivery_type, 'domicile');
      v_parcel_point := case when v_delivery_type = 'point_relais' then to_jsonb(v_profile.default_relay_point) else null end;
      v_instructions := v_profile.delivery_instructions;
    end if;

    insert into public.shipments (reseller_id, requested_by_profile_id, delivery_type, parcel_point, delivery_instructions, shipping_cost)
    values (v_item.reseller_id, v_item.placed_by_profile_id, v_delivery_type, v_parcel_point, v_instructions, 0)
    returning id into v_shipment_id;
  end if;

  update public.order_items
  set shipment_id = v_shipment_id,
      received_at = coalesce(received_at, now()),
      ready_to_ship_at = coalesce(ready_to_ship_at, now()),
      delivery_requested_at = now(),
      fulfillment_status = 'delivery_requested'
  where id = p_item_id;

  v_new_status := public.recompute_shipment_status(v_shipment_id);

  return jsonb_build_object(
    'shipment_id', v_shipment_id,
    'added_to_existing', v_pending is not null,
    'delivery_type', coalesce(v_delivery_type, (select delivery_type from public.shipments where id = v_shipment_id)),
    'shipment_status', v_new_status
  );
end;
$$;

revoke all on function public.admin_request_delivery_for_item(uuid) from public, anon;
grant execute on function public.admin_request_delivery_for_item(uuid) to authenticated;

notify pgrst, 'reload schema';
