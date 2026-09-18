-- ============================================================================
-- Les commandes issues d'une enchère ne doivent JAMAIS pouvoir être annulées
-- ni remboursées — ni en libre-service par le revendeur (cancel-my-b2b-
-- order-item, fenêtre de 24h), ni par un admin OZË (cancel-b2b-order /
-- cancel-b2b-order-item). Contrairement à un achat catalogue classique, le
-- prix a été fixé par une mise en concurrence entre revendeurs : le
-- rembourser reviendrait à défaire l'adjudication elle-même.
--
-- generate_order_from_auction_item_core (0142) pose order_channel='b2b'
-- exactement comme un achat catalogue classique — rien ne distinguait donc
-- une commande d'enchère au niveau de `orders` elle-même. Le seul marqueur
-- fiable est le lien inverse : un auction_items.order_id qui pointe vers
-- cette commande. Ajoute ce contrôle directement dans cancel_b2b_order_item
-- et cancel_b2b_order (les deux SECURITY DEFINER appelées par les trois
-- Edge Functions de cancellation) plutôt que dans chaque Edge Function
-- séparément : défense en profondeur, aucun appelant ne peut contourner.
-- ============================================================================

create or replace function public.cancel_b2b_order_item(
  p_order_item_id uuid,
  p_reason text,
  p_restock_action text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item record;
  v_order record;
  v_new_subtotal numeric;
  v_new_insurance numeric;
  v_new_total numeric;
  v_remaining_active integer;
  v_new_order_status text;
  v_refund_amount numeric;
begin
  if p_restock_action not in ('draft', 'for-sale-b2b', 'archived') then
    raise exception 'restock_action invalide : %', p_restock_action;
  end if;

  select * into v_item from public.order_items where id = p_order_item_id for update;
  if not found then
    raise exception 'Article de commande introuvable';
  end if;
  if v_item.status = 'cancelled' then
    raise exception 'Cet article est déjà annulé';
  end if;

  select * into v_order from public.orders where id = v_item.order_id for update;
  if not found then
    raise exception 'Commande introuvable';
  end if;

  if exists (select 1 from public.auction_items where order_id = v_order.id) then
    raise exception 'Un lot remporté aux enchères ne peut pas être annulé ni remboursé';
  end if;

  update public.order_items
  set status = 'cancelled', cancellation_reason = p_reason, cancelled_at = now(), restock_action = p_restock_action
  where id = p_order_item_id;

  select coalesce(sum(line_total), 0), coalesce(sum(case when insured then insurance_cost else 0 end), 0)
  into v_new_subtotal, v_new_insurance
  from public.order_items
  where order_id = v_order.id and status = 'active';

  v_new_total := v_new_subtotal - coalesce(v_order.discount_amount, 0) + coalesce(v_order.shipping_cost, 0) + v_new_insurance;

  select count(*) into v_remaining_active from public.order_items where order_id = v_order.id and status = 'active';
  v_new_order_status := case when v_remaining_active = 0 then 'cancelled' else v_order.status end;

  update public.orders
  set subtotal = v_new_subtotal,
      insurance_cost = v_new_insurance,
      total_amount = v_new_total,
      status = v_new_order_status
  where id = v_order.id;

  update public.products
  set status = p_restock_action,
      reserved_by_reseller_id = null,
      reserved_by_order_id = null,
      reserved_at = null
  where id = v_item.product_id;

  v_refund_amount := v_item.line_total + case when v_item.insured then v_item.insurance_cost else 0 end;

  return jsonb_build_object(
    'order_id', v_order.id,
    'order_item_id', p_order_item_id,
    'line_total', v_item.line_total,
    'refund_amount', v_refund_amount,
    'new_total_amount', v_new_total,
    'order_status', v_new_order_status,
    'payment_status', v_order.payment_status,
    'stripe_payment_intent_id', v_order.stripe_payment_intent_id,
    'reseller_id', v_order.reseller_id,
    'placed_by_profile_id', v_order.placed_by_profile_id
  );
end;
$$;

create or replace function public.cancel_b2b_order(
  p_order_id uuid,
  p_reason text,
  p_restock_action text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_total_refund numeric := 0;
  v_cancelled_item_ids uuid[] := '{}';
  v_item record;
begin
  if p_restock_action not in ('draft', 'for-sale-b2b', 'archived') then
    raise exception 'restock_action invalide : %', p_restock_action;
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Commande introuvable';
  end if;

  if exists (select 1 from public.auction_items where order_id = v_order.id) then
    raise exception 'Un lot remporté aux enchères ne peut pas être annulé ni remboursé';
  end if;

  for v_item in
    select * from public.order_items where order_id = p_order_id and status = 'active' for update
  loop
    update public.order_items
    set status = 'cancelled', cancellation_reason = p_reason, cancelled_at = now(), restock_action = p_restock_action
    where id = v_item.id;

    update public.products
    set status = p_restock_action,
        reserved_by_reseller_id = null,
        reserved_by_order_id = null,
        reserved_at = null
    where id = v_item.product_id;

    v_total_refund := v_total_refund + v_item.line_total + case when v_item.insured then v_item.insurance_cost else 0 end;
    v_cancelled_item_ids := v_cancelled_item_ids || v_item.id;
  end loop;

  if array_length(v_cancelled_item_ids, 1) is null then
    raise exception 'Aucun article actif à annuler sur cette commande';
  end if;

  update public.orders
  set subtotal = 0,
      insurance_cost = 0,
      total_amount = 0 - coalesce(v_order.discount_amount, 0) + coalesce(v_order.shipping_cost, 0),
      status = 'cancelled'
  where id = p_order_id;

  return jsonb_build_object(
    'order_id', p_order_id,
    'order_item_ids', to_jsonb(v_cancelled_item_ids),
    'total_refund', v_total_refund,
    'payment_status', v_order.payment_status,
    'stripe_payment_intent_id', v_order.stripe_payment_intent_id,
    'reseller_id', v_order.reseller_id,
    'placed_by_profile_id', v_order.placed_by_profile_id
  );
end;
$$;

notify pgrst, 'reload schema';
