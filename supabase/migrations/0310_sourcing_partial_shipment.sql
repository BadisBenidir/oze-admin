-- ============================================================================
-- Sourcing sur mesure : envoyer une première partie avant la clôture.
--
-- admin_sourcing_ship_partial(mission, pièces) : pour une mission ACTIVE,
-- l'admin choisit des pièces déjà reçues dans nos locaux (products.received_at)
-- et les expédie tout de suite :
--   - la commande de la mission (0197/0205) est créée si besoin (total =
--     l'avance, payée), sans clôturer la mission ;
--   - les pièces y sont ajoutées (fiche produit vendue), l'avance est
--     répartie sur les pièces de la commande (sourcing_reallocate_order) ;
--   - une demande de livraison port payé (0 €) est créée vers le point
--     relais favori du membre (profiles.default_relay_point).
-- La mission reste active : on peut continuer à proposer des pièces. À la
-- clôture, admin_generate_sourcing_order reprend la commande existante,
-- y ajoute les pièces restantes, répartit l'avance et crée la demande de
-- livraison du reste.
-- Garde-fous : une pièce déjà dans la commande ne peut plus être retirée
-- d'une mission active ; la validation par le membre (portail) est refusée
-- une fois une partie expédiée (l'équipe clôture).
-- ============================================================================

create or replace function public.admin_sourcing_ship_partial(p_mission_id uuid, p_item_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mission record;
  v_profile record;
  v_email text;
  v_order_id uuid;
  v_shipment_id uuid;
  v_item record;
  v_order_item_id uuid;
  v_order_item_ids uuid[] := '{}';
begin
  if not public.is_admin() then
    raise exception 'Accès refusé : réservé aux administrateurs';
  end if;
  if p_item_ids is null or array_length(p_item_ids, 1) is null then
    raise exception 'Aucune pièce sélectionnée';
  end if;

  select * into v_mission from public.b2b_sourcing_missions where id = p_mission_id for update;
  if not found then
    raise exception 'Mission introuvable';
  end if;
  if v_mission.status <> 'active' then
    raise exception 'Envoi partiel possible uniquement sur une mission active (mission clôturée : utilisez la commande)';
  end if;
  if v_mission.user_id is null then
    raise exception 'Aucun membre rattaché à cette mission';
  end if;

  select default_relay_point, delivery_instructions into v_profile from public.profiles where id = v_mission.user_id;
  if v_profile.default_relay_point is null then
    raise exception 'Le membre n''a pas de point relais favori : impossible de créer la livraison';
  end if;

  -- Contrôle de chaque pièce avant toute écriture.
  for v_item in
    select i.id, i.title, i.status, i.product_id, p.received_at, p.status as product_status,
           exists (
             select 1 from public.order_items oi
             where oi.order_id = v_mission.order_id and oi.product_id = i.product_id and oi.status = 'active'
           ) as in_order
    from unnest(p_item_ids) as sel(id)
    left join public.b2b_sourcing_items i on i.id = sel.id and i.mission_id = p_mission_id
    left join public.products p on p.id = i.product_id
  loop
    if v_item.id is null then
      raise exception 'Une pièce sélectionnée n''appartient pas à cette mission';
    end if;
    if v_item.status = 'cancelled' then
      raise exception 'Pièce annulée : %', v_item.title;
    end if;
    if v_item.product_id is null then
      raise exception 'Pièce sans fiche produit : %', v_item.title;
    end if;
    if v_item.received_at is null then
      raise exception 'Pièce pas encore reçue dans nos locaux : %', v_item.title;
    end if;
    if v_item.in_order then
      raise exception 'Pièce déjà envoyée : %', v_item.title;
    end if;
    if v_item.product_status not in ('draft', 'draft-b2b', 'sourced-b2b') then
      raise exception 'Pièce plus disponible (statut %) : %', v_item.product_status, v_item.title;
    end if;
  end loop;

  -- Commande de la mission, créée au premier envoi (total = l'avance, payée).
  v_order_id := v_mission.order_id;
  if v_order_id is null then
    select coalesce((select p.email from public.profiles p where p.id = v_mission.user_id), r.contact_email)
      into v_email from public.resellers r where r.id = v_mission.reseller_id;

    insert into public.orders (
      order_number, email, status, total_amount, subtotal, shipping_cost, currency,
      payment_status, paid_at, reseller_id, placed_by_profile_id,
      order_channel, approval_status, approved_at, is_sourcing_fulfillment
    ) values (
      public.next_sourcing_order_number(v_mission.reference), v_email, 'confirmed', v_mission.advance_amount, v_mission.advance_amount, 0, 'EUR',
      'paid', coalesce(v_mission.paid_at, now()), v_mission.reseller_id, v_mission.user_id,
      'b2b', 'approved', now(), true
    )
    returning id into v_order_id;

    update public.b2b_sourcing_missions
    set order_id = v_order_id, order_generated_by_admin = true
    where id = p_mission_id;
  end if;

  -- Demande de livraison port payé vers le point relais favori.
  insert into public.shipments (reseller_id, requested_by_profile_id, delivery_type, parcel_point, delivery_instructions, shipping_cost)
  values (v_mission.reseller_id, v_mission.user_id, 'point_relais', to_jsonb(v_profile.default_relay_point), v_profile.delivery_instructions, 0)
  returning id into v_shipment_id;

  for v_item in
    select i.id, i.product_id from public.b2b_sourcing_items i
    where i.id = any(p_item_ids) and i.mission_id = p_mission_id
    order by i.created_at
  loop
    insert into public.order_items (order_id, product_id, quantity, unit_price, line_total, product_snapshot)
    select v_order_id, p.id, 1, 0, 0, to_jsonb(p.*)
    from public.products p where p.id = v_item.product_id
    returning id into v_order_item_id;
    v_order_item_ids := v_order_item_ids || v_order_item_id;

    update public.products
    set status = 'sold-b2b', reserved_by_reseller_id = v_mission.reseller_id, reserved_by_order_id = v_order_id,
        reserved_at = coalesce(reserved_at, now())
    where id = v_item.product_id;
  end loop;

  update public.order_items
  set shipment_id = v_shipment_id,
      received_at = coalesce(received_at, now()),
      ready_to_ship_at = coalesce(ready_to_ship_at, now()),
      delivery_requested_at = now(),
      fulfillment_status = 'delivery_requested'
  where id = any(v_order_item_ids);

  perform public.recompute_shipment_status(v_shipment_id);
  perform public.sourcing_reallocate_order(p_mission_id);

  return jsonb_build_object(
    'order_id', v_order_id,
    'order_number', (select order_number from public.orders where id = v_order_id),
    'shipment_id', v_shipment_id,
    'items', array_length(v_order_item_ids, 1)
  );
end;
$$;

revoke all on function public.admin_sourcing_ship_partial(uuid, uuid[]) from public, anon;
grant execute on function public.admin_sourcing_ship_partial(uuid, uuid[]) to authenticated;

-- ----------------------------------------------------------------------------
-- Clôture : reprend la commande déjà créée par un envoi partiel.
-- ----------------------------------------------------------------------------
create or replace function public.admin_generate_sourcing_order(p_mission_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_mission record;
  v_reseller_email text;
  v_order_id uuid;
  v_item_count integer;
  v_total_cost numeric;
  v_allocated numeric;
  v_order_date timestamptz;
  v_added integer := 0;
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

  -- Mission active avec une commande issue d'un envoi partiel (0310) :
  -- on y ajoute les pièces restantes, puis clôture.
  if v_mission.order_id is not null and v_mission.status = 'active' then
    if exists (
      select 1 from public.b2b_sourcing_items i
      where i.mission_id = p_mission_id and i.status <> 'cancelled' and i.product_id is null
    ) then
      raise exception 'Certaines pièces n''ont pas de fiche produit : liez-les avant de générer la commande';
    end if;

    insert into public.order_items (order_id, product_id, quantity, unit_price, line_total, product_snapshot)
    select v_mission.order_id, p.id, 1, 0, 0, to_jsonb(p.*)
    from public.b2b_sourcing_items i
    join public.products p on p.id = i.product_id
    where i.mission_id = p_mission_id and i.status <> 'cancelled'
      and not exists (
        select 1 from public.order_items oi
        where oi.order_id = v_mission.order_id and oi.product_id = i.product_id and oi.status = 'active'
      );
    get diagnostics v_added = row_count;

    update public.products p
    set status = 'sold-b2b', reserved_by_reseller_id = v_mission.reseller_id, reserved_by_order_id = v_mission.order_id,
        reserved_at = coalesce(p.reserved_at, now())
    from public.b2b_sourcing_items i
    where i.mission_id = p_mission_id and i.status <> 'cancelled' and p.id = i.product_id;

    update public.b2b_sourcing_items
    set status = 'validated'
    where mission_id = p_mission_id and status <> 'cancelled';

    update public.b2b_sourcing_missions
    set status = 'completed', order_generated_by_admin = true
    where id = p_mission_id;

    perform public.sourcing_reallocate_order(p_mission_id);
    perform public.admin_create_sourcing_delivery_request(p_mission_id);

    return jsonb_build_object('order_id', v_mission.order_id, 'order_number', (select order_number from public.orders where id = v_mission.order_id), 'items_added', v_added, 'total', v_mission.advance_amount);
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

  update tmp_sourcing_order
  set alloc = round(
    case when v_total_cost > 0 then v_mission.advance_amount * cost_price / v_total_cost
         else v_mission.advance_amount / v_item_count end, 2)
  where rn < v_item_count;
  select coalesce(sum(alloc), 0) into v_allocated from tmp_sourcing_order where rn < v_item_count;
  update tmp_sourcing_order set alloc = v_mission.advance_amount - v_allocated where rn = v_item_count;

  v_order_date := coalesce(v_mission.completed_at, now());
  select coalesce((select p.email from public.profiles p where p.id = v_mission.user_id), r.contact_email)
    into v_reseller_email from public.resellers r where r.id = v_mission.reseller_id;

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

  perform public.admin_create_sourcing_delivery_request(p_mission_id);

  return jsonb_build_object('order_id', v_order_id, 'order_number', (select order_number from public.orders where id = v_order_id), 'items', v_item_count, 'total', v_mission.advance_amount);
end;
$function$;

-- ----------------------------------------------------------------------------
-- Pièce déjà envoyée (dans la commande) : plus retirable d'une mission active.
-- ----------------------------------------------------------------------------
create or replace function public.guard_sourcing_item_already_shipped()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mission record;
begin
  if old.product_id is null then
    return old;
  end if;
  select status, order_id into v_mission from public.b2b_sourcing_missions where id = old.mission_id;
  if found and v_mission.status = 'active' and v_mission.order_id is not null and exists (
    select 1 from public.order_items oi
    where oi.order_id = v_mission.order_id and oi.product_id = old.product_id and oi.status = 'active'
  ) then
    raise exception 'Cette pièce a déjà été envoyée au membre : elle ne peut plus être retirée de la mission';
  end if;
  return old;
end;
$$;

drop trigger if exists guard_sourcing_item_already_shipped on public.b2b_sourcing_items;
create trigger guard_sourcing_item_already_shipped
  before delete on public.b2b_sourcing_items
  for each row execute function public.guard_sourcing_item_already_shipped();

-- ----------------------------------------------------------------------------
-- Validation par le membre refusée après un envoi partiel.
-- ----------------------------------------------------------------------------
do $$
declare
  v_def text := pg_get_functiondef('public.reseller_validate_sourcing_mission'::regproc);
  v_anchor text := '  if not v_mission.is_published_to_reseller then';
begin
  if position('0310_partial' in v_def) = 0 then
    if position(v_anchor in v_def) = 0 then
      raise exception 'reseller_validate_sourcing_mission : point d''insertion introuvable';
    end if;
    v_def := replace(v_def, v_anchor,
      '  -- 0310_partial : une partie déjà envoyée, la clôture revient à l''équipe.' || chr(10) ||
      '  if v_mission.order_id is not null then' || chr(10) ||
      '    raise exception ''Une partie de votre sourcing vous a déjà été envoyée : notre équipe clôturera la mission avec vous'';' || chr(10) ||
      '  end if;' || chr(10) || v_anchor);
    execute v_def;
  end if;
end;
$$;

notify pgrst, 'reload schema';
