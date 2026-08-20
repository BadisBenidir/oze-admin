-- ============================================================================
-- RPCs du cycle de statut par article B2B : réception admin (ordered ->
-- received -> ready_to_ship) et demande de livraison revendeur
-- (ready_to_ship -> delivery_requested, création du shipment). La
-- génération des étiquettes Sendcloud (delivery_requested -> shipped) se
-- fait côté edge function generate-b2b-shipment-labels, pas ici (appel
-- réseau externe impossible en SQL).
-- ============================================================================

create or replace function public.admin_mark_items_received(p_item_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated_ids uuid[];
begin
  if not public.is_admin() then
    raise exception 'Accès refusé';
  end if;

  update public.order_items oi
  set fulfillment_status = 'received', received_at = now()
  from public.orders o
  where oi.order_id = o.id
    and oi.id = any(p_item_ids)
    and oi.fulfillment_status = 'ordered'
    and oi.status = 'active'
    and o.order_channel = 'b2b'
  returning oi.id into v_updated_ids;

  return jsonb_build_object(
    'updated_ids', to_jsonb(coalesce(v_updated_ids, array[]::uuid[])),
    'updated_count', coalesce(array_length(v_updated_ids, 1), 0)
  );
end;
$$;

grant execute on function public.admin_mark_items_received(uuid[]) to authenticated;

create or replace function public.admin_mark_items_ready_to_ship(p_item_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated_ids uuid[];
begin
  if not public.is_admin() then
    raise exception 'Accès refusé';
  end if;

  update public.order_items oi
  set fulfillment_status = 'ready_to_ship', ready_to_ship_at = now()
  from public.orders o
  where oi.order_id = o.id
    and oi.id = any(p_item_ids)
    and oi.fulfillment_status = 'received'
    and oi.status = 'active'
    and o.order_channel = 'b2b'
  returning oi.id into v_updated_ids;

  return jsonb_build_object(
    'updated_ids', to_jsonb(coalesce(v_updated_ids, array[]::uuid[])),
    'updated_count', coalesce(array_length(v_updated_ids, 1), 0)
  );
end;
$$;

grant execute on function public.admin_mark_items_ready_to_ship(uuid[]) to authenticated;

create or replace function public.reseller_request_item_delivery(
  p_item_ids uuid[],
  p_delivery_type text,
  p_parcel_point jsonb default null,
  p_instructions text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reseller_id uuid;
  v_eligible_ids uuid[];
  v_shipment_id uuid;
begin
  v_reseller_id := public.current_reseller_id();
  if v_reseller_id is null then
    raise exception 'Aucun compte revendeur actif associé à cet utilisateur';
  end if;

  if p_item_ids is null or array_length(p_item_ids, 1) is null then
    raise exception 'Aucun article sélectionné';
  end if;

  if p_delivery_type not in ('domicile', 'point_relais') then
    raise exception 'Mode de livraison invalide';
  end if;
  if p_delivery_type = 'point_relais' and (p_parcel_point is null or p_parcel_point->>'name' is null) then
    raise exception 'Point relais incomplet';
  end if;

  -- Verrouille les lignes concernées : évite qu'un autre appel concurrent
  -- (autre membre de l'équipe, double-clic) ne rattache deux fois les mêmes
  -- articles à des shipments différents.
  select array_agg(oi.id) into v_eligible_ids
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where oi.id = any(p_item_ids)
    and oi.fulfillment_status = 'ready_to_ship'
    and oi.status = 'active'
    and o.order_channel = 'b2b'
    and o.reseller_id = v_reseller_id
  for update of oi;

  if v_eligible_ids is null or array_length(v_eligible_ids, 1) <> array_length(p_item_ids, 1) then
    raise exception 'Certains articles ne sont plus disponibles pour une demande de livraison';
  end if;

  insert into public.shipments (reseller_id, requested_by_profile_id, delivery_type, parcel_point, delivery_instructions)
  values (v_reseller_id, auth.uid(), p_delivery_type, p_parcel_point, p_instructions)
  returning id into v_shipment_id;

  update public.order_items
  set fulfillment_status = 'delivery_requested', delivery_requested_at = now(), shipment_id = v_shipment_id
  where id = any(v_eligible_ids);

  return jsonb_build_object('shipment_id', v_shipment_id, 'item_count', array_length(v_eligible_ids, 1));
end;
$$;

grant execute on function public.reseller_request_item_delivery(uuid[], text, jsonb, text) to authenticated;

notify pgrst, 'reload schema';
