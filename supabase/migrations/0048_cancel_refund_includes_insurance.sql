-- ============================================================================
-- Module B2B Revendeurs — 48 : le remboursement d'une annulation doit inclure
-- l'assurance payée sur l'article, pas seulement son line_total.
--
-- cancel_b2b_order_item/cancel_b2b_order (0032, 0047) recalculaient déjà
-- correctement order.insurance_cost pour les articles RESTANTS, mais le
-- montant renvoyé pour REMBOURSER l'article ANNULÉ ne portait que sur
-- line_total — l'assurance que le revendeur avait payée pour cet article
-- précis n'était jamais recréditée, ni en portefeuille ni via Stripe.
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

  -- Montant à REMBOURSER pour cet article : son prix + l'assurance payée
  -- dessus, si applicable — distinct de line_total, qui ne porte jamais que
  -- sur le prix de l'article.
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

revoke all on function public.cancel_b2b_order_item(uuid, text, text) from public, anon, authenticated;

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

    -- Inclut l'assurance payée sur cet article, pas seulement son line_total.
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

revoke all on function public.cancel_b2b_order(uuid, text, text) from public, anon, authenticated;

notify pgrst, 'reload schema';
