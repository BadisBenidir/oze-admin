-- ============================================================================
-- Corrige reseller_validate_sourcing_mission (0098) : Supabase active par
-- défaut l'extension pg_safeupdate, qui interdit tout UPDATE sans clause
-- WHERE — y compris sur une table temporaire. Les deux UPDATE qui
-- répartissent le montant sur toutes les lignes de tmp_sourcing_alloc n'en
-- avaient pas ("UPDATE requires a WHERE clause" à l'exécution). Ajout d'un
-- `where true` neutre : comportement inchangé (toutes les lignes doivent
-- être mises à jour), juste explicite pour ce garde-fou.
-- ============================================================================

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

  if not (v_mission.reseller_id = public.current_reseller_id() or v_mission.user_id = auth.uid()) then
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
