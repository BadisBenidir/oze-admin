-- ============================================================================
-- Pénalité de retard de paiement des lots d'enchères.
--
-- CGV (version 2026-10-18) : un lot adjugé doit être payé sous 24 h ; passé
-- l'échéance (auction_items.payment_deadline, sinon commande + 24 h), une
-- pénalité de 5 % du prix du lot est due par jour de retard commencé.
--
--   - auction_late_fee(order) : jours de retard et montant, calculés à
--     l'instant T sur le prix du lot (total hors pénalité) ;
--   - apply_auction_late_fee(order) : fige la pénalité sur la commande au
--     moment du paiement — orders.late_fee_amount / late_fee_days, et
--     total_amount = prix du lot + pénalité (facture, CA, paiement) ;
--   - l'admin peut annuler la pénalité d'un lot (late_fee_waived).
-- Appliquée par pay_auction_order_with_wallet (solde) et par la fonction
-- Edge auction-order-payment avant de créer la session Stripe (carte, mixte).
-- ============================================================================

alter table public.orders add column if not exists late_fee_amount numeric(10, 2) not null default 0;
alter table public.orders add column if not exists late_fee_days integer not null default 0;
alter table public.orders add column if not exists late_fee_waived boolean not null default false;

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

  if v_deadline is not null
     and v_order.payment_status <> 'paid'
     and not v_order.late_fee_waived
     and now() > v_deadline then
    v_days := ceil(extract(epoch from (now() - v_deadline)) / 86400.0)::integer;
  end if;

  return query select v_base, v_days, round(v_base * 0.05 * v_days, 2), v_deadline;
end;
$$;
-- Interne (lu via get_my_pending_auction_payments côté membre, et recalculé
-- côté admin à partir de la commande) : jamais exposée telle quelle.
revoke all on function public.auction_late_fee(uuid) from public, anon, authenticated;
grant execute on function public.auction_late_fee(uuid) to service_role;

-- Fige la pénalité sur la commande (au paiement). Interne : appelée par les
-- RPC de paiement (SECURITY DEFINER) et par auction-order-payment (service role).
create or replace function public.apply_auction_late_fee(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fee record;
begin
  perform 1 from public.orders where id = p_order_id for update;
  select * into v_fee from public.auction_late_fee(p_order_id);
  if v_fee.base_amount is null then
    raise exception 'Commande introuvable';
  end if;

  update public.orders
  set late_fee_amount = coalesce(v_fee.late_fee, 0),
      late_fee_days = coalesce(v_fee.late_days, 0),
      total_amount = v_fee.base_amount + coalesce(v_fee.late_fee, 0)
  where id = p_order_id and payment_status <> 'paid';

  return jsonb_build_object('base_amount', v_fee.base_amount, 'late_days', v_fee.late_days, 'late_fee', v_fee.late_fee,
                            'total', v_fee.base_amount + coalesce(v_fee.late_fee, 0));
end;
$$;
revoke all on function public.apply_auction_late_fee(uuid) from public, anon, authenticated;
grant execute on function public.apply_auction_late_fee(uuid) to service_role;

-- Annulation (ou rétablissement) de la pénalité d'un lot par l'admin.
create or replace function public.admin_set_auction_late_fee_waived(p_order_id uuid, p_waived boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.admin_can('refunds') then
    raise exception 'Action non autorisée : annuler une pénalité';
  end if;
  update public.orders set late_fee_waived = p_waived where id = p_order_id;
  -- Commande pas encore payée : total remis au prix du lot (+ pénalité en cours si rétablie).
  return public.apply_auction_late_fee(p_order_id);
end;
$$;
revoke all on function public.admin_set_auction_late_fee_waived(uuid, boolean) from public, anon;
grant execute on function public.admin_set_auction_late_fee_waived(uuid, boolean) to authenticated;

-- Paiement par solde (dernière version : 0144) : pénalité figée avant débit.
create or replace function public.pay_auction_order_with_wallet(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_balance numeric;
  v_item_status text;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order is null then
    raise exception 'Commande introuvable';
  end if;
  if v_order.placed_by_profile_id <> auth.uid() then
    raise exception 'Cette commande ne vous appartient pas';
  end if;
  if v_order.order_channel <> 'b2b' then
    raise exception 'Commande invalide';
  end if;
  if v_order.payment_status = 'paid' then
    return jsonb_build_object('already_paid', true, 'order_id', p_order_id);
  end if;

  select status into v_item_status from public.auction_items where order_id = p_order_id;
  if v_item_status is distinct from 'sold' then
    raise exception 'Ce lot n''a pas encore été adjugé — paiement impossible pour le moment';
  end if;

  perform public.apply_auction_late_fee(p_order_id);
  select * into v_order from public.orders where id = p_order_id;

  select wallet_balance into v_balance from public.profiles where id = auth.uid() for update;
  if v_balance is null or v_balance < v_order.total_amount then
    raise exception 'Solde insuffisant';
  end if;

  update public.profiles set wallet_balance = wallet_balance - v_order.total_amount where id = auth.uid();
  update public.orders set payment_status = 'paid' where id = p_order_id;

  insert into public.wallet_transactions (profile_id, reseller_id, amount, type, status, order_id)
  values (auth.uid(), v_order.reseller_id, v_order.total_amount, 'achat', 'success', p_order_id);

  return jsonb_build_object('already_paid', false, 'order_id', p_order_id, 'late_fee', v_order.late_fee_amount);
end;
$$;
grant execute on function public.pay_auction_order_with_wallet(uuid) to authenticated;

-- Lots à payer du membre (dernière version : 0156) : montant dû à l'instant
-- (prix + pénalité en cours) et détail de la pénalité.
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
  late_fee numeric
)
language sql
security definer
stable
set search_path = public
as $$
  select ai.id, ai.title, ai.brand, ai.images, o.id, o.order_number,
         f.base_amount + f.late_fee, ai.payment_deadline,
         f.base_amount, f.late_days, f.late_fee
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
