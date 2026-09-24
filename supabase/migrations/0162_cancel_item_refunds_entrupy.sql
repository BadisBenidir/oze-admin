-- ============================================================================
-- Annuler un article annule et rembourse aussi son certificat Entrupy.
--
-- Jusqu'ici cancel_b2b_order_item / cancel_b2b_order (0146) :
--   - laissaient entrupy_requested = true sur l'article annulé (il restait
--     "À faire" sur la page Entrupy) et ne remboursaient pas les 19,99 € ;
--   - recalculaient total_amount SANS les certificats : annuler un article
--     faisait disparaître du total (donc du CA) les certificats de TOUS les
--     autres articles de la commande.
--
-- Désormais, dans la même transaction que l'annulation :
--   - le certificat de l'article annulé est retiré (entrupy_requested=false,
--     entrupy_cost=0, même effet que admin_cancel_entrupy_certificate, 0141) ;
--   - s'il était payé, il est crédité sur le solde du payeur — même règle que
--     le retrait manuel d'un certificat (toujours en solde, jamais Stripe :
--     il a pu être payé via une session Stripe distincte de la commande) ;
--   - total_amount / orders.entrupy_cost sont recalculés avec les certificats
--     des articles restés actifs.
-- Tous les appelants (cancel-b2b-order-item, cancel-b2b-order,
-- cancel-my-b2b-order-item, cancel-shipment-items) en bénéficient sans
-- modification. Le montant crédité est renvoyé dans entrupy_refund_amount.
-- La garde "lot d'enchère jamais annulable ici" (0146) est conservée.
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
  v_new_entrupy numeric;
  v_new_total numeric;
  v_remaining_active integer;
  v_new_order_status text;
  v_refund_amount numeric;
  v_entrupy_refund numeric := 0;
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

  if v_item.entrupy_requested and coalesce(v_item.entrupy_cost, 0) > 0 and v_order.payment_status = 'paid' then
    v_entrupy_refund := v_item.entrupy_cost;
  end if;

  update public.order_items
  set status = 'cancelled', cancellation_reason = p_reason, cancelled_at = now(), restock_action = p_restock_action,
      entrupy_requested = false, entrupy_cost = 0
  where id = p_order_item_id;

  select coalesce(sum(line_total), 0),
         coalesce(sum(case when insured then insurance_cost else 0 end), 0),
         coalesce(sum(case when entrupy_requested then entrupy_cost else 0 end), 0)
  into v_new_subtotal, v_new_insurance, v_new_entrupy
  from public.order_items
  where order_id = v_order.id and status = 'active';

  v_new_total := v_new_subtotal - coalesce(v_order.discount_amount, 0) + coalesce(v_order.shipping_cost, 0) + v_new_insurance + v_new_entrupy;

  select count(*) into v_remaining_active from public.order_items where order_id = v_order.id and status = 'active';
  v_new_order_status := case when v_remaining_active = 0 then 'cancelled' else v_order.status end;

  update public.orders
  set subtotal = v_new_subtotal,
      insurance_cost = v_new_insurance,
      entrupy_cost = v_new_entrupy,
      total_amount = v_new_total,
      status = v_new_order_status
  where id = v_order.id;

  update public.products
  set status = p_restock_action,
      reserved_by_reseller_id = null,
      reserved_by_order_id = null,
      reserved_at = null
  where id = v_item.product_id;

  if v_entrupy_refund > 0 then
    perform public.credit_order_item_refund_to_wallet(
      v_order.placed_by_profile_id, v_order.reseller_id, v_entrupy_refund, v_order.id,
      'Remboursement (certificat Entrupy, article annulé) — commande ' || v_order.id
    );
  end if;

  v_refund_amount := v_item.line_total + case when v_item.insured then v_item.insurance_cost else 0 end;

  return jsonb_build_object(
    'order_id', v_order.id,
    'order_item_id', p_order_item_id,
    'line_total', v_item.line_total,
    'refund_amount', v_refund_amount,
    'entrupy_refund_amount', v_entrupy_refund,
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
  v_entrupy_refund numeric := 0;
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
    if v_item.entrupy_requested and coalesce(v_item.entrupy_cost, 0) > 0 and v_order.payment_status = 'paid' then
      v_entrupy_refund := v_entrupy_refund + v_item.entrupy_cost;
    end if;

    update public.order_items
    set status = 'cancelled', cancellation_reason = p_reason, cancelled_at = now(), restock_action = p_restock_action,
        entrupy_requested = false, entrupy_cost = 0
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
      entrupy_cost = 0,
      total_amount = 0 - coalesce(v_order.discount_amount, 0) + coalesce(v_order.shipping_cost, 0),
      status = 'cancelled'
  where id = p_order_id;

  if v_entrupy_refund > 0 then
    perform public.credit_order_item_refund_to_wallet(
      v_order.placed_by_profile_id, v_order.reseller_id, v_entrupy_refund, v_order.id,
      'Remboursement (certificats Entrupy, commande annulée) — commande ' || v_order.id
    );
  end if;

  return jsonb_build_object(
    'order_id', p_order_id,
    'order_item_ids', to_jsonb(v_cancelled_item_ids),
    'total_refund', v_total_refund,
    'entrupy_refund_amount', v_entrupy_refund,
    'payment_status', v_order.payment_status,
    'stripe_payment_intent_id', v_order.stripe_payment_intent_id,
    'reseller_id', v_order.reseller_id,
    'placed_by_profile_id', v_order.placed_by_profile_id
  );
end;
$$;

notify pgrst, 'reload schema';
