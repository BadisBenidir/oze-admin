-- ============================================================================
-- Mission de sourcing clôturée : retirer / ajouter des pièces après coup
-- (pièce absente du carton au moment de la clôture, remplacée par une autre).
-- La commande de suivi (0205) suit : ligne annulée ou ajoutée, avance
-- répartie à nouveau sur les pièces restantes (au prorata du coût, comme à la
-- génération), demande de livraison mise à jour. La marge de la mission
-- (prix revendeur - coût des pièces) se recalcule d'elle-même.
--   - sourcing_reallocate_order : nouvelle répartition de l'avance ;
--   - admin_sourcing_closed_remove_item : retire une pièce (refusé si déjà
--     expédiée) ; la fiche produit repasse en brouillon B2B ;
--   - admin_sourcing_closed_add_items : ajoute à la commande les pièces
--     nouvellement ajoutées à la mission (statut 'sourced'), demande de
--     livraison comprise.
-- ============================================================================

create or replace function public.sourcing_reallocate_order(p_mission_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mission record;
  v_count int;
  v_total_cost numeric;
  v_allocated numeric;
begin
  select * into v_mission from public.b2b_sourcing_missions where id = p_mission_id;
  if v_mission.order_id is null then
    return;
  end if;

  create temporary table tmp_realloc (
    order_item_id uuid primary key,
    cost_price numeric,
    rn int,
    alloc numeric
  ) on commit drop;

  insert into tmp_realloc (order_item_id, cost_price, rn)
  select oi.id, coalesce(si.cost_price, 0), row_number() over (order by si.created_at, si.id)
  from public.order_items oi
  join lateral (
    select s.cost_price, s.created_at, s.id from public.b2b_sourcing_items s
    where s.mission_id = p_mission_id and s.product_id = oi.product_id and s.status <> 'cancelled'
    order by s.created_at limit 1
  ) si on true
  where oi.order_id = v_mission.order_id and oi.status = 'active';

  select count(*), coalesce(sum(cost_price), 0) into v_count, v_total_cost from tmp_realloc;
  if v_count = 0 then
    drop table tmp_realloc;
    return;
  end if;

  update tmp_realloc
  set alloc = round(
    case when v_total_cost > 0 then v_mission.advance_amount * cost_price / v_total_cost
         else v_mission.advance_amount / v_count end, 2)
  where rn < v_count;
  select coalesce(sum(alloc), 0) into v_allocated from tmp_realloc where rn < v_count;
  update tmp_realloc set alloc = v_mission.advance_amount - v_allocated where rn = v_count;

  update public.order_items oi
  set unit_price = t.alloc, line_total = t.alloc
  from tmp_realloc t
  where oi.id = t.order_item_id;

  update public.orders
  set total_amount = v_mission.advance_amount, subtotal = v_mission.advance_amount,
      status = case when status = 'cancelled' then 'confirmed' else status end
  where id = v_mission.order_id;

  drop table tmp_realloc;
end;
$$;

revoke all on function public.sourcing_reallocate_order(uuid) from public, anon, authenticated;

create or replace function public.admin_sourcing_closed_remove_item(p_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item record;
  v_mission record;
  v_order_item record;
  v_remaining int;
begin
  if not public.is_admin() then
    raise exception 'Accès refusé : réservé aux administrateurs';
  end if;

  select * into v_item from public.b2b_sourcing_items where id = p_item_id;
  if not found then
    raise exception 'Pièce introuvable';
  end if;
  select * into v_mission from public.b2b_sourcing_missions where id = v_item.mission_id for update;
  if v_mission.status <> 'completed' or v_mission.order_id is null then
    raise exception 'Cette mission n''est pas clôturée avec une commande';
  end if;

  if v_item.product_id is not null then
    select * into v_order_item from public.order_items
    where order_id = v_mission.order_id and product_id = v_item.product_id and status = 'active'
    limit 1;

    if v_order_item.id is not null then
      if v_order_item.fulfillment_status in ('label_created', 'shipped', 'delivered') then
        raise exception 'Cette pièce est déjà expédiée : elle ne peut plus être retirée';
      end if;

      update public.order_items
      set status = 'cancelled', cancelled_at = now(), cancellation_reason = 'Retirée du sourcing (absente du carton)',
          refund_status = 'not_applicable', shipment_id = null, parcel_id = null, delivery_requested_at = null
      where id = v_order_item.id;

      -- Demande de livraison vidée : annulée.
      if v_order_item.shipment_id is not null then
        select count(*) into v_remaining from public.order_items
        where shipment_id = v_order_item.shipment_id and status = 'active';
        if v_remaining = 0 then
          delete from public.shipment_parcels where shipment_id = v_order_item.shipment_id and status in ('pending', 'failed');
          update public.shipments
          set status = 'cancelled', cancelled_at = now(), cancellation_reason = 'Pièces retirées du sourcing', updated_at = now()
          where id = v_order_item.shipment_id and status <> 'cancelled';
        end if;
      end if;
    end if;

    update public.products
    set status = 'draft-b2b', reserved_by_reseller_id = null, reserved_by_order_id = null, reserved_at = null
    where id = v_item.product_id and status in ('sold-b2b', 'sourced-b2b', 'reserved-b2b');
  end if;

  delete from public.b2b_sourcing_items where id = p_item_id;

  perform public.sourcing_reallocate_order(v_mission.id);

  return jsonb_build_object('mission_id', v_mission.id, 'removed_order_item_id', v_order_item.id);
end;
$$;

grant execute on function public.admin_sourcing_closed_remove_item(uuid) to authenticated;

create or replace function public.admin_sourcing_closed_add_items(p_mission_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mission record;
  v_item record;
  v_order_item_id uuid;
  v_order_date timestamptz;
  v_added int := 0;
  v_without_product int := 0;
  v_delivery_errors text[] := '{}';
begin
  if not public.is_admin() then
    raise exception 'Accès refusé : réservé aux administrateurs';
  end if;

  select * into v_mission from public.b2b_sourcing_missions where id = p_mission_id for update;
  if not found then
    raise exception 'Mission introuvable';
  end if;
  if v_mission.status <> 'completed' or v_mission.order_id is null then
    raise exception 'Cette mission n''est pas clôturée avec une commande';
  end if;

  select coalesce(created_at, now()) into v_order_date from public.orders where id = v_mission.order_id;

  for v_item in
    select * from public.b2b_sourcing_items
    where mission_id = p_mission_id and status = 'sourced'
    order by created_at
  loop
    if v_item.product_id is null then
      v_without_product := v_without_product + 1;
      continue;
    end if;

    insert into public.order_items (order_id, product_id, quantity, unit_price, line_total, product_snapshot)
    select v_mission.order_id, p.id, 1, 0, 0, to_jsonb(p.*)
    from public.products p where p.id = v_item.product_id
    returning id into v_order_item_id;

    update public.products
    set status = 'sold-b2b', reserved_by_reseller_id = v_mission.reseller_id, reserved_by_order_id = v_mission.order_id,
        reserved_at = coalesce(reserved_at, now())
    where id = v_item.product_id;

    update public.b2b_sourcing_items set status = 'validated' where id = v_item.id;
    v_added := v_added + 1;

    begin
      perform public.admin_request_delivery_for_item(v_order_item_id);
    exception when others then
      v_delivery_errors := v_delivery_errors || sqlerrm;
    end;
  end loop;

  perform public.sourcing_reallocate_order(p_mission_id);

  return jsonb_build_object('added', v_added, 'without_product', v_without_product, 'delivery_errors', to_jsonb(v_delivery_errors));
end;
$$;

grant execute on function public.admin_sourcing_closed_add_items(uuid) to authenticated;

notify pgrst, 'reload schema';
