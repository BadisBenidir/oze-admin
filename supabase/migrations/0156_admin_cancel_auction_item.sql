-- ============================================================================
-- Annulation d'un lot d'enchère adjugé — ADMIN UNIQUEMENT.
--
-- 0146 interdit toute annulation/remboursement d'une commande d'enchère via
-- les chemins génériques (cancel_b2b_order_item / cancel_b2b_order), qui
-- restent inchangés : le revendeur ne peut toujours rien annuler lui-même.
-- On ajoute ici un chemin dédié, appelé uniquement par l'Edge Function
-- cancel-auction-item (contrôle profiles.role='admin', service-role), qui :
--   - passe le lot en 'cancelled' (nouveau statut) ;
--   - annule la commande générée (si elle existe) et remet le produit au
--     statut choisi ;
--   - renvoie la répartition réellement payée (part solde / part carte) pour
--     que l'Edge Function rembourse au bon endroit.
-- Un lot adjugé mais pas encore payé peut aussi être annulé (aucun
-- remboursement dans ce cas).
-- ============================================================================

alter table public.auction_items drop constraint if exists auction_items_status_check;
alter table public.auction_items add constraint auction_items_status_check
  check (status in ('active', 'sold', 'unsold', 'cancelled'));

alter table public.auction_items add column if not exists cancelled_at timestamptz;
alter table public.auction_items add column if not exists cancellation_reason text;
alter table public.auction_items add column if not exists refund_status text
  check (refund_status is null or refund_status in ('not_applicable', 'succeeded', 'failed'));
alter table public.auction_items add column if not exists refund_method text
  check (refund_method is null or refund_method in ('wallet', 'stripe'));
alter table public.auction_items add column if not exists refund_error text;

create or replace function public.admin_cancel_auction_item_core(
  p_item_id uuid,
  p_reason text,
  p_restock_action text,
  p_refund_method text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item record;
  v_order record;
  v_wallet_paid numeric := 0;
  v_card_paid numeric := 0;
  v_is_paid boolean := false;
begin
  if p_restock_action not in ('draft', 'draft-b2b', 'for-sale-b2b', 'archived') then
    raise exception 'restock_action invalide : %', p_restock_action;
  end if;
  if p_refund_method is not null and p_refund_method not in ('wallet', 'stripe') then
    raise exception 'refund_method invalide : %', p_refund_method;
  end if;

  select * into v_item from public.auction_items where id = p_item_id for update;
  if not found then
    raise exception 'Lot introuvable';
  end if;
  if v_item.status = 'cancelled' then
    raise exception 'Ce lot est déjà annulé';
  end if;
  if v_item.status <> 'sold' then
    raise exception 'Seul un lot adjugé peut être annulé';
  end if;

  if v_item.order_id is not null then
    select * into v_order from public.orders where id = v_item.order_id for update;
  end if;

  if v_order.id is not null then
    v_is_paid := v_order.payment_status = 'paid';

    if v_is_paid then
      select coalesce(sum(amount), 0) into v_wallet_paid
      from public.wallet_transactions
      where order_id = v_order.id and type = 'achat' and status = 'success';
      v_card_paid := greatest(coalesce(v_order.total_amount, 0) - v_wallet_paid, 0);

      if p_refund_method is null then
        raise exception 'Choisissez un mode de remboursement (Stripe ou crédit) pour ce lot payé';
      end if;
      if p_refund_method = 'stripe' and (v_order.stripe_payment_intent_id is null or v_card_paid <= 0) then
        raise exception 'Ce lot a été payé entièrement avec le solde — remboursement Stripe impossible, choisissez le crédit';
      end if;
    end if;

    update public.order_items
    set status = 'cancelled', cancellation_reason = p_reason, cancelled_at = now(), restock_action = p_restock_action
    where order_id = v_order.id and status = 'active';

    update public.orders
    set subtotal = 0, insurance_cost = 0, total_amount = 0, status = 'cancelled'
    where id = v_order.id;
  end if;

  if v_item.product_id is not null then
    update public.products
    set status = p_restock_action,
        reserved_by_reseller_id = null,
        reserved_by_order_id = null,
        reserved_at = null
    where id = v_item.product_id;
  end if;

  update public.auction_items
  set status = 'cancelled',
      cancelled_at = now(),
      cancellation_reason = p_reason,
      refund_status = case when v_is_paid then null else 'not_applicable' end
  where id = p_item_id;

  return jsonb_build_object(
    'item_id', p_item_id,
    'order_id', v_order.id,
    'is_paid', v_is_paid,
    'wallet_paid', v_wallet_paid,
    'card_paid', v_card_paid,
    'stripe_payment_intent_id', v_order.stripe_payment_intent_id,
    'reseller_id', v_order.reseller_id,
    'placed_by_profile_id', v_order.placed_by_profile_id
  );
end;
$$;

revoke all on function public.admin_cancel_auction_item_core(uuid, text, text, text) from public, anon, authenticated;

-- Un lot annulé ne doit plus apparaître dans "À payer" côté revendeur
-- (sa commande est 'cancelled' mais reste payment_status='pending').
create or replace function public.get_my_pending_auction_payments()
returns table (
  item_id uuid,
  title text,
  brand text,
  images text[],
  order_id uuid,
  order_number text,
  amount numeric,
  payment_deadline timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select ai.id, ai.title, ai.brand, ai.images, o.id, o.order_number, o.total_amount, ai.payment_deadline
  from public.auction_items ai
  join public.orders o on o.id = ai.order_id
  where ai.current_winner_id = auth.uid()
    and ai.status = 'sold'
    and o.payment_status = 'pending'
    and o.status <> 'cancelled'
  order by ai.payment_deadline asc nulls last;
$$;

grant execute on function public.get_my_pending_auction_payments() to authenticated;

notify pgrst, 'reload schema';
