-- ============================================================================
-- Vente B2B directe (hors plateforme) : bascule un produit brouillon
-- directement en `sold-b2b`, attribué à un revendeur choisi par l'admin.
-- Crée une commande B2B minimale (payée, confirmée) pour que la vente soit
-- automatiquement comptée dans le calcul existant de CA/marge B2B
-- (vue b2b_order_item_revenue / useB2BRevenue.ts) sans aucune modification
-- de ce calcul — même bookkeeping produit que confirm_b2b_payment.
-- ============================================================================

create or replace function public.admin_record_direct_b2b_sale(
  p_product_id uuid,
  p_reseller_id uuid,
  p_sale_price numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product record;
  v_reseller_email text;
  v_price numeric;
  v_order_id uuid;
  v_order_number text;
begin
  if not public.is_admin() then
    raise exception 'Accès refusé';
  end if;

  select * into v_product from public.products where id = p_product_id for update;
  if v_product is null then
    raise exception 'Produit introuvable';
  end if;
  if v_product.status <> 'draft' then
    raise exception 'Seul un produit brouillon peut être basculé directement en vente B2B';
  end if;

  select contact_email into v_reseller_email from public.resellers where id = p_reseller_id;
  if v_reseller_email is null then
    raise exception 'Revendeur introuvable';
  end if;

  v_price := coalesce(p_sale_price, v_product.sale_price, 0);
  v_order_number := 'B2B-DIRECT-' || to_char(now(), 'YYYYMMDDHH24MISS') || '-' || substr(p_reseller_id::text, 1, 4);

  insert into public.orders (
    order_number, email, status, total_amount, subtotal, shipping_cost, currency,
    payment_status, reseller_id, placed_by_profile_id,
    order_channel, approval_status, approved_at
  ) values (
    v_order_number, v_reseller_email, 'confirmed', v_price, v_price, 0, 'EUR',
    'paid', p_reseller_id, null,
    'b2b', 'approved', now()
  )
  returning id into v_order_id;

  insert into public.order_items (order_id, product_id, quantity, unit_price, line_total, product_snapshot)
  values (v_order_id, p_product_id, 1, v_price, v_price, to_jsonb(v_product));

  update public.products
  set status = 'sold-b2b', reserved_by_reseller_id = p_reseller_id, reserved_by_order_id = v_order_id, reserved_at = now()
  where id = p_product_id;

  return jsonb_build_object('order_id', v_order_id, 'order_number', v_order_number);
end;
$$;

grant execute on function public.admin_record_direct_b2b_sale(uuid, uuid, numeric) to authenticated;

notify pgrst, 'reload schema';
