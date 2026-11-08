-- ============================================================================
-- Assurance des lots d'enchères (0,6 % du prix du lot, comme le panier 0021).
--
-- Les lots adjugés ne passent pas par le panier : jusqu'ici aucune case
-- « Assurer cet article ». Le membre la coche désormais au paiement du lot
-- (AuctionPaymentsDue) ; auction-order-payment appelle
-- set_my_auction_order_insurance avant tout débit / session Stripe :
--   - order_items.insured / insurance_cost sur l'article du lot ;
--   - orders.insurance_cost, insured_value (valeur déclarée Sendcloud, 0025)
--     et total_amount (prix + assurance + pénalité) ;
--   - décocher retire l'assurance (session carte abandonnée puis repayée).
-- auction_late_fee : la pénalité de retard (5 %/jour, 0210) reste calculée
-- sur le seul prix du lot, jamais sur l'assurance.
-- ============================================================================

create or replace function public.set_my_auction_order_insurance(p_order_id uuid, p_insured boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_item record;
  v_cost numeric;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order is null then
    raise exception 'Commande introuvable';
  end if;
  if v_order.placed_by_profile_id is distinct from auth.uid() then
    raise exception 'Cette commande ne vous appartient pas';
  end if;
  if v_order.order_channel <> 'b2b' or v_order.payment_status = 'paid' then
    raise exception 'Commande déjà payée ou invalide';
  end if;
  if not exists (select 1 from public.auction_items where order_id = p_order_id and status = 'sold') then
    raise exception 'Ce lot n''a pas encore été adjugé';
  end if;

  select oi.id, oi.line_total into v_item
  from public.order_items oi
  where oi.order_id = p_order_id and oi.status = 'active'
  limit 1;
  if v_item.id is null then
    raise exception 'Article du lot introuvable';
  end if;

  v_cost := case when p_insured then round(coalesce(v_item.line_total, 0) * 0.006, 2) else 0 end;

  update public.order_items
  set insured = p_insured, insurance_cost = v_cost
  where id = v_item.id;

  update public.orders
  set total_amount = total_amount - coalesce(insurance_cost, 0) + v_cost,
      insurance_cost = v_cost,
      insured_value = case when p_insured then coalesce(v_item.line_total, 0) else 0 end
  where id = p_order_id;

  return jsonb_build_object('insured', p_insured, 'insurance_cost', v_cost);
end;
$$;
revoke all on function public.set_my_auction_order_insurance(uuid, boolean) from public, anon;
grant execute on function public.set_my_auction_order_insurance(uuid, boolean) to authenticated;

-- 0210 : base_amount = prix du lot + assurance (total hors pénalité) ; la
-- pénalité ne porte que sur le prix du lot.
create or replace function public.auction_late_fee(p_order_id uuid)
returns table (base_amount numeric, late_days integer, late_fee numeric, deadline timestamptz)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_order record;
  v_deadline timestamptz;
  v_base numeric;
  v_lot numeric;
  v_days integer := 0;
begin
  select o.* into v_order from public.orders o where o.id = p_order_id;
  if not found then
    return;
  end if;
  select coalesce(ai.payment_deadline, v_order.created_at + interval '24 hours') into v_deadline
  from public.auction_items ai where ai.order_id = p_order_id
  limit 1;
  v_base := coalesce(v_order.total_amount, 0) - coalesce(v_order.late_fee_amount, 0);
  v_lot := v_base - coalesce(v_order.insurance_cost, 0);

  if v_deadline is not null
     and v_order.payment_status <> 'paid'
     and not v_order.late_fee_waived
     and now() > v_deadline then
    v_days := ceil(extract(epoch from (now() - v_deadline)) / 86400.0)::integer;
  end if;

  return query select v_base, v_days, round(v_lot * 0.05 * v_days, 2), v_deadline;
end;
$$;
revoke all on function public.auction_late_fee(uuid) from public, anon, authenticated;
grant execute on function public.auction_late_fee(uuid) to service_role;

-- Lots à payer (0210) + assurance déjà posée sur la commande (session carte
-- abandonnée) : le front affiche le prix du lot et la case pré-cochée.
drop function if exists public.get_my_pending_auction_payments();
create or replace function public.get_my_pending_auction_payments()
returns table (
  item_id uuid,
  title text,
  brand text,
  images text[],
  order_id uuid,
  order_number text,
  amount numeric,
  payment_deadline timestamptz,
  base_amount numeric,
  late_days integer,
  late_fee numeric,
  insurance_cost numeric
)
language sql
security definer
stable
set search_path = public
as $$
  select ai.id, ai.title, ai.brand, ai.images, o.id, o.order_number,
         f.base_amount + f.late_fee, ai.payment_deadline,
         f.base_amount, f.late_days, f.late_fee, coalesce(o.insurance_cost, 0)
  from public.auction_items ai
  join public.orders o on o.id = ai.order_id
  cross join lateral public.auction_late_fee(o.id) f
  where ai.current_winner_id = auth.uid()
    and ai.status = 'sold'
    and o.payment_status = 'pending'
    and o.status <> 'cancelled'
  order by ai.payment_deadline asc nulls last;
$$;
grant execute on function public.get_my_pending_auction_payments() to authenticated;

notify pgrst, 'reload schema';
