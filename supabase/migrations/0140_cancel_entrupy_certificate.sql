-- ============================================================================
-- Annulation du SEUL certificat Entrupy d'un article de commande B2B, sans
-- annuler l'article lui-même (contrairement à cancel_b2b_order_item, 0032) —
-- remboursement toujours en crédit portefeuille, jamais de choix Stripe ici
-- (contrairement à cancel-b2b-order-item), sur demande explicite de l'admin.
-- ============================================================================

create or replace function public.admin_cancel_entrupy_certificate(p_order_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item record;
  v_order record;
  v_amount numeric;
begin
  if not public.is_admin() then
    raise exception 'Accès refusé';
  end if;

  select * into v_item from public.order_items where id = p_order_item_id for update;
  if v_item is null then
    raise exception 'Article introuvable';
  end if;
  if v_item.status <> 'active' then
    raise exception 'Cet article est annulé';
  end if;
  if not v_item.entrupy_requested then
    raise exception 'Aucun certificat Entrupy sur cet article';
  end if;

  v_amount := v_item.entrupy_cost;

  update public.order_items
  set entrupy_requested = false, entrupy_cost = 0
  where id = p_order_item_id;

  select * into v_order from public.orders where id = v_item.order_id for update;

  update public.orders
  set entrupy_cost = greatest(entrupy_cost - v_amount, 0),
      total_amount = greatest(total_amount - v_amount, 0)
  where id = v_item.order_id;

  return jsonb_build_object(
    'order_id', v_item.order_id,
    'refund_amount', v_amount,
    'payment_status', v_order.payment_status,
    'placed_by_profile_id', v_order.placed_by_profile_id,
    'reseller_id', v_order.reseller_id
  );
end;
$$;

grant execute on function public.admin_cancel_entrupy_certificate(uuid) to authenticated;

notify pgrst, 'reload schema';
