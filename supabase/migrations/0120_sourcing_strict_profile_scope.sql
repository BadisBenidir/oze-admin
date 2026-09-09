-- ============================================================================
-- BUG URGENT : le sourcing sur mesure doit être strictement nominatif à UN
-- sous-compte (1 sous-compte = 1 sourcing), jamais visible par le reste de
-- l'entreprise même une fois publié. Les vues revendeur et la validation
-- laissaient passer n'importe quel sous-compte du même reseller_id via un
-- `or m.reseller_id = current_reseller_id()` — corrigé en gardant
-- UNIQUEMENT `m.user_id = auth.uid()`.
-- ============================================================================

-- reseller_sourcing_missions (cartes de mission, voir 0096 pour la dernière
-- définition avant ce correctif) — même liste de colonnes, WHERE resserré.
create or replace view public.reseller_sourcing_missions as
select
  m.id,
  m.reseller_id,
  m.user_id,
  m.title,
  m.advance_amount,
  m.paid_at,
  m.status,
  m.is_published_to_reseller,
  m.published_at,
  m.created_at,
  m.reference
from public.b2b_sourcing_missions m
where m.status != 'cancelled'
  and m.user_id = auth.uid();

grant select on public.reseller_sourcing_missions to authenticated;

-- reseller_sourcing_items (pièces sourcées, voir 0097 pour la dernière
-- définition) — même liste de colonnes, WHERE resserré.
create or replace view public.reseller_sourcing_items as
select
  i.id,
  i.mission_id,
  i.title,
  i.brand,
  i.photos,
  i.status,
  i.created_at,
  p.description,
  p.condition,
  p.material,
  p.colors,
  p.serial_number,
  p.defects,
  p.defect_images,
  c.name as category_name
from public.b2b_sourcing_items i
join public.b2b_sourcing_missions m on m.id = i.mission_id
left join public.products p on p.id = i.product_id
left join public.categories c on c.id = p.category_id
where m.is_published_to_reseller = true
  and i.status != 'cancelled'
  and m.user_id = auth.uid();

grant select on public.reseller_sourcing_items to authenticated;

-- reseller_validate_sourcing_mission (0098/0099) — même garde-fou côté
-- écriture : un sous-compte ne doit pouvoir valider QUE sa propre mission,
-- jamais celle d'un collègue de la même entreprise (ça créerait la
-- commande et réserverait les produits en son nom à tort).
create or replace function public.reseller_validate_sourcing_mission(p_mission_id uuid)
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
  v_remainder numeric;
  v_first_item_id uuid;
begin
  select * into v_mission from public.b2b_sourcing_missions where id = p_mission_id for update;
  if v_mission is null then
    raise exception 'Mission introuvable';
  end if;

  if v_mission.user_id is distinct from auth.uid() then
    raise exception 'Accès refusé';
  end if;

  if v_mission.status <> 'active' then
    raise exception 'Cette mission n''est plus en cours de sélection';
  end if;
  if not v_mission.is_published_to_reseller then
    raise exception 'Cette mission n''est pas encore prête à être validée';
  end if;

  create temporary table tmp_sourcing_alloc (
    item_id uuid primary key,
    product_id uuid,
    cost_price numeric,
    alloc numeric
  ) on commit drop;

  insert into tmp_sourcing_alloc (item_id, product_id, cost_price)
  select i.id, i.product_id, coalesce(i.cost_price, 0)
  from public.b2b_sourcing_items i
  where i.mission_id = p_mission_id and i.status <> 'cancelled';

  select count(*) into v_item_count from tmp_sourcing_alloc;
  if v_item_count = 0 then
    raise exception 'Aucune pièce à valider sur cette mission';
  end if;

  if exists (select 1 from tmp_sourcing_alloc where product_id is null) then
    raise exception 'Certaines pièces ne sont pas encore finalisées par notre équipe — contactez-nous avant de valider';
  end if;

  perform 1 from public.products p join tmp_sourcing_alloc t on t.product_id = p.id for update;

  if exists (
    select 1 from tmp_sourcing_alloc t join public.products p on p.id = t.product_id where p.status <> 'draft'
  ) then
    raise exception 'Certaines pièces ne sont plus disponibles — contactez notre équipe';
  end if;

  select coalesce(sum(cost_price), 0) into v_total_cost from tmp_sourcing_alloc;

  if v_total_cost > 0 then
    update tmp_sourcing_alloc set alloc = round(v_mission.advance_amount * cost_price / v_total_cost, 2) where true;
  else
    update tmp_sourcing_alloc set alloc = round(v_mission.advance_amount / v_item_count, 2) where true;
  end if;

  select v_mission.advance_amount - coalesce(sum(alloc), 0) into v_remainder from tmp_sourcing_alloc;
  select item_id into v_first_item_id from tmp_sourcing_alloc order by item_id limit 1;
  update tmp_sourcing_alloc set alloc = alloc + v_remainder where item_id = v_first_item_id;

  select contact_email into v_reseller_email from public.resellers where id = v_mission.reseller_id;

  insert into public.orders (
    order_number, email, status, total_amount, subtotal, shipping_cost, currency,
    payment_status, reseller_id, placed_by_profile_id,
    order_channel, approval_status, approved_at
  ) values (
    v_mission.reference, v_reseller_email, 'confirmed', v_mission.advance_amount, v_mission.advance_amount, 0, 'EUR',
    'paid', v_mission.reseller_id, v_mission.user_id,
    'b2b', 'approved', now()
  )
  returning id into v_order_id;

  insert into public.order_items (order_id, product_id, quantity, unit_price, line_total, product_snapshot)
  select v_order_id, p.id, 1, t.alloc, t.alloc, to_jsonb(p.*)
  from tmp_sourcing_alloc t
  join public.products p on p.id = t.product_id;

  update public.products p
  set status = 'sold-b2b', reserved_by_reseller_id = v_mission.reseller_id, reserved_by_order_id = v_order_id, reserved_at = now()
  from tmp_sourcing_alloc t
  where p.id = t.product_id;

  update public.b2b_sourcing_items
  set status = 'validated'
  where mission_id = p_mission_id and status <> 'cancelled';

  update public.b2b_sourcing_missions
  set status = 'completed', order_id = v_order_id
  where id = p_mission_id;

  return jsonb_build_object('order_id', v_order_id, 'order_number', v_mission.reference);
end;
$$;

grant execute on function public.reseller_validate_sourcing_mission(uuid) to authenticated;

notify pgrst, 'reload schema';
