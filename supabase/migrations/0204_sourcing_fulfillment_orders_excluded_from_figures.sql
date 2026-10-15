-- ============================================================================
-- Commandes de suivi des missions de sourcing clôturées par l'admin.
--
-- « Générer la commande » (0197/0203) crée une commande uniquement pour
-- suivre les pièces (réception, prêt à la livraison, carton, demande de
-- livraison). Elle ne doit changer AUCUN chiffre : la mission reste comptée
-- comme avant (avance encaissée / vente à la clôture, voir
-- useAccountingRawData, useB2BRevenue, orderService.getOrderStats).
--
-- orders.is_sourcing_fulfillment marque ces commandes dès leur création :
--   - exclues de la vue b2b_order_item_revenue (Chiffre d'affaires B2B) ;
--   - jamais choisies pour rattacher un portefeuille offert (le trigger
--     d'insertion voit la colonne, posée dans le même INSERT) ;
--   - côté front, exclues des totaux (CA, marge, ventes, panier moyen…).
-- ============================================================================

alter table public.orders add column if not exists is_sourcing_fulfillment boolean not null default false;

-- Commandes déjà générées avant cette migration (s'il y en a).
update public.orders o
set is_sourcing_fulfillment = true
from public.b2b_sourcing_missions m
where m.order_id = o.id and m.order_generated_by_admin and not o.is_sourcing_fulfillment;

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

  return jsonb_build_object('order_id', v_order_id, 'order_number', (select order_number from public.orders where id = v_order_id), 'items', v_item_count, 'total', v_mission.advance_amount);
end;
$$;

revoke all on function public.admin_generate_sourcing_order(uuid) from public, anon;
grant execute on function public.admin_generate_sourcing_order(uuid) to authenticated;

create or replace view public.b2b_order_item_revenue as
select
  oi.id as order_item_id,
  oi.order_id,
  o.reseller_id,
  oi.status,
  oi.line_total,
  coalesce(p.purchase_price, 0) as purchase_price
from public.order_items oi
join public.orders o on o.id = oi.order_id
left join public.products p on p.id = oi.product_id
where o.order_channel = 'b2b'
  and not o.is_sourcing_fulfillment
  and public.is_admin();

create or replace function public.assign_pending_gift_rewards()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile record;
  v_gift record;
  v_order_id uuid;
begin
  for v_profile in
    select distinct profile_id from public.b2b_gift_rewards where assigned_order_id is null and status = 'pending'
  loop
    for v_gift in
      select g.id, coalesce(wt.created_at, g.created_at) as recharge_date
      from public.b2b_gift_rewards g
      join public.wallet_transactions wt on wt.id = g.transaction_id
      where g.profile_id = v_profile.profile_id and g.assigned_order_id is null and g.status = 'pending'
      order by coalesce(wt.created_at, g.created_at) asc
    loop
      select o.id into v_order_id
      from public.orders o
      where o.placed_by_profile_id = v_profile.profile_id
        and o.order_channel = 'b2b'
        and o.status <> 'cancelled'
        and not o.is_sourcing_fulfillment
        and o.created_at >= v_gift.recharge_date
        and not exists (select 1 from public.b2b_gift_rewards g2 where g2.assigned_order_id = o.id)
      order by o.created_at asc
      limit 1;

      if v_order_id is not null then
        update public.b2b_gift_rewards set status = 'assigned', assigned_order_id = v_order_id where id = v_gift.id;
        perform public.sync_gift_reward_from_order(v_order_id);
      end if;

      v_order_id := null;
    end loop;
  end loop;
end;
$$;

notify pgrst, 'reload schema';
