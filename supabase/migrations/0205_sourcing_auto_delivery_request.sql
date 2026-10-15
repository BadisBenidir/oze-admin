-- ============================================================================
-- Missions de sourcing : demande de livraison créée directement par l'admin.
--
-- Pour une mission, le membre n'a pas à faire sa demande de livraison depuis
-- son portail : admin_create_sourcing_delivery_request crée la demande pour
-- lui (adresse de son profil, port déjà inclus dans l'avance : 0 €), avec
-- toutes les pièces de la commande pas encore dans une demande. Les pièces
-- passent « Livraison demandée » ; l'admin coche ensuite « dans le carton »
-- (0202) au fil de la préparation. Appelée automatiquement par
-- admin_generate_sourcing_order (clôture / « Générer la commande »), et
-- disponible en bouton pour une commande déjà générée.
-- ============================================================================

create or replace function public.admin_create_sourcing_delivery_request(p_mission_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mission record;
  v_item_ids uuid[];
  v_shipment_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Accès refusé : réservé aux administrateurs';
  end if;

  select * into v_mission from public.b2b_sourcing_missions where id = p_mission_id;
  if not found then
    raise exception 'Mission introuvable';
  end if;
  if v_mission.order_id is null then
    raise exception 'Cette mission n''a pas encore de commande';
  end if;
  if v_mission.user_id is null then
    raise exception 'Aucun membre rattaché à cette mission';
  end if;

  perform 1 from public.order_items
  where order_id = v_mission.order_id and status = 'active' and shipment_id is null
    and fulfillment_status in ('ordered', 'received', 'ready_to_ship')
  for update;

  select array_agg(id) into v_item_ids
  from public.order_items
  where order_id = v_mission.order_id and status = 'active' and shipment_id is null
    and fulfillment_status in ('ordered', 'received', 'ready_to_ship');

  if v_item_ids is null then
    return jsonb_build_object('shipment_id', null, 'item_count', 0);
  end if;

  insert into public.shipments (reseller_id, requested_by_profile_id, delivery_type, shipping_cost)
  values (v_mission.reseller_id, v_mission.user_id, 'domicile', 0)
  returning id into v_shipment_id;

  update public.order_items
  set fulfillment_status = 'delivery_requested', delivery_requested_at = now(), shipment_id = v_shipment_id
  where id = any(v_item_ids);

  return jsonb_build_object('shipment_id', v_shipment_id, 'item_count', array_length(v_item_ids, 1));
end;
$$;

revoke all on function public.admin_create_sourcing_delivery_request(uuid) from public, anon;
grant execute on function public.admin_create_sourcing_delivery_request(uuid) to authenticated;

create or replace function public.admin_generate_sourcing_order(p_mission_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mission record;
  v_reseller_email text;
  v_order_id uuid;
  v_item_count integer;
  v_total_cost numeric;
  v_allocated numeric;
  v_order_date timestamptz;
begin
  if not public.is_admin() then
    raise exception 'Accès refusé : réservé aux administrateurs';
  end if;

  select * into v_mission from public.b2b_sourcing_missions where id = p_mission_id for update;
  if not found then
    raise exception 'Mission introuvable';
  end if;
  if v_mission.status = 'cancelled' then
    raise exception 'Cette mission est annulée';
  end if;
  if v_mission.order_id is not null then
    raise exception 'Cette mission a déjà une commande';
  end if;

  create temporary table tmp_sourcing_order (
    item_id uuid primary key,
    product_id uuid,
    cost_price numeric,
    rn integer,
    alloc numeric
  ) on commit drop;

  insert into tmp_sourcing_order (item_id, product_id, cost_price, rn)
  select i.id, i.product_id, coalesce(i.cost_price, 0), row_number() over (order by i.created_at, i.id)
  from public.b2b_sourcing_items i
  where i.mission_id = p_mission_id and i.status <> 'cancelled';

  select count(*), coalesce(sum(cost_price), 0) into v_item_count, v_total_cost from tmp_sourcing_order;

  -- Mission sans pièce : simple clôture, rien à commander.
  if v_item_count = 0 then
    update public.b2b_sourcing_missions set status = 'completed' where id = p_mission_id;
    return jsonb_build_object('order_id', null, 'closed', true, 'items', 0);
  end if;

  if exists (select 1 from tmp_sourcing_order where product_id is null) then
    raise exception 'Certaines pièces n''ont pas de fiche produit : liez-les avant de générer la commande';
  end if;

  -- Répartition de l'avance au prorata du coût (parts égales si aucun coût),
  -- au centime ; la dernière pièce absorbe l'arrondi.
  update tmp_sourcing_order
  set alloc = round(
    case when v_total_cost > 0 then v_mission.advance_amount * cost_price / v_total_cost
         else v_mission.advance_amount / v_item_count end, 2)
  where rn < v_item_count;
  select coalesce(sum(alloc), 0) into v_allocated from tmp_sourcing_order where rn < v_item_count;
  update tmp_sourcing_order set alloc = v_mission.advance_amount - v_allocated where rn = v_item_count;

  v_order_date := coalesce(v_mission.completed_at, now());
  select contact_email into v_reseller_email from public.resellers where id = v_mission.reseller_id;

  insert into public.orders (
    order_number, email, status, total_amount, subtotal, shipping_cost, currency,
    payment_status, paid_at, reseller_id, placed_by_profile_id,
    order_channel, approval_status, approved_at, created_at, is_sourcing_fulfillment
  ) values (
    public.next_sourcing_order_number(v_mission.reference), v_reseller_email, 'confirmed', v_mission.advance_amount, v_mission.advance_amount, 0, 'EUR',
    'paid', coalesce(v_mission.paid_at, v_order_date), v_mission.reseller_id, v_mission.user_id,
    'b2b', 'approved', v_order_date, v_order_date, true
  )
  returning id into v_order_id;

  insert into public.order_items (order_id, product_id, quantity, unit_price, line_total, product_snapshot)
  select v_order_id, p.id, 1, t.alloc, t.alloc, to_jsonb(p.*)
  from tmp_sourcing_order t
  join public.products p on p.id = t.product_id;

  update public.products p
  set status = 'sold-b2b', reserved_by_reseller_id = v_mission.reseller_id, reserved_by_order_id = v_order_id,
      reserved_at = coalesce(p.reserved_at, v_order_date)
  from tmp_sourcing_order t
  where p.id = t.product_id;

  update public.b2b_sourcing_items
  set status = 'validated'
  where mission_id = p_mission_id and status <> 'cancelled';

  update public.b2b_sourcing_missions
  set status = 'completed', order_id = v_order_id, order_generated_by_admin = true
  where id = p_mission_id;

  -- Demande de livraison créée directement pour le membre (pas de demande
  -- à faire depuis son portail).
  perform public.admin_create_sourcing_delivery_request(p_mission_id);

  return jsonb_build_object('order_id', v_order_id, 'order_number', (select order_number from public.orders where id = v_order_id), 'items', v_item_count, 'total', v_mission.advance_amount);
end;
$$;

revoke all on function public.admin_generate_sourcing_order(uuid) from public, anon;
grant execute on function public.admin_generate_sourcing_order(uuid) to authenticated;

notify pgrst, 'reload schema';
