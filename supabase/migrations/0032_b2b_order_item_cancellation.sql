-- ============================================================================
-- Module B2B Revendeurs — 32 : annulation d'un article au sein d'une commande
--
-- Permet d'annuler UN article d'une commande B2B sans annuler la commande
-- entière : recalcule subtotal/insurance_cost/total_amount à partir des
-- articles restants actifs, remet le produit en vente ou l'archive, et passe
-- la commande à 'cancelled' si plus aucun article actif n'y subsiste. Le
-- remboursement Stripe (si commande payée) est fait côté Edge Function
-- (cancel-b2b-order-item), jamais en base.
-- ============================================================================

alter table public.order_items add column if not exists status text not null default 'active' check (status in ('active', 'cancelled'));
alter table public.order_items add column if not exists cancellation_reason text;
alter table public.order_items add column if not exists cancelled_at timestamptz;
alter table public.order_items add column if not exists restock_action text check (restock_action is null or restock_action in ('draft', 'for-sale-b2b', 'archived'));
alter table public.order_items add column if not exists stripe_refund_id text;
alter table public.order_items add column if not exists refund_status text check (refund_status is null or refund_status in ('not_applicable', 'succeeded', 'failed'));

-- 'archived' : nouveau statut produit terminal, pour un article annulé que
-- l'on ne souhaite remettre ni en brouillon ni au catalogue B2B.
alter table public.products drop constraint if exists products_status_check;
alter table public.products
  add constraint products_status_check check (status in (
    'draft', 'for-sale-online', 'for-sale-other-platform', 'sold-online',
    'sold-other-platform', 'sold-display', 'for-auction-live', 'sold-auction',
    'for-sale-b2b', 'reserved-b2b', 'sold-b2b', 'archived'
  ));

----------------------------------------------------------------------------
-- cancel_b2b_order_item : recalcul atomique. SECURITY DEFINER, jamais
-- exposée directement au client (seule l'Edge Function, via service_role,
-- l'appelle après avoir vérifié que l'appelant est admin) — c'est la
-- fonction elle-même qui décide du montant à rembourser, jamais le client.
----------------------------------------------------------------------------
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

  return jsonb_build_object(
    'order_id', v_order.id,
    'order_item_id', p_order_item_id,
    'line_total', v_item.line_total,
    'new_total_amount', v_new_total,
    'order_status', v_new_order_status,
    'payment_status', v_order.payment_status,
    'stripe_payment_intent_id', v_order.stripe_payment_intent_id
  );
end;
$$;

revoke all on function public.cancel_b2b_order_item(uuid, text, text) from public, anon, authenticated;

notify pgrst, 'reload schema';
