-- ============================================================================
-- Module B2B Revendeurs — 6 : achat instantané, sans validation admin
--
-- Les revendeurs achètent désormais comme un client normal : la commande est
-- confirmée immédiatement à la soumission, plus d'étape "en attente de
-- validation". La réservation atomique des pièces uniques reste
-- indispensable pour éviter une double-vente (deux revendeurs, ou un
-- revendeur et le site public, sur la même pièce), mais elle mène
-- directement à une vente confirmée au lieu d'un état intermédiaire
-- "reserved-b2b".
--
-- Remplace intégralement la fonction submit_b2b_order créée dans 0004.
-- ============================================================================

create or replace function public.submit_b2b_order(
  p_product_ids uuid[],
  p_shipping_address jsonb,
  p_billing_address jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reseller_id uuid;
  v_discount numeric;
  v_email text;
  v_reserved_ids uuid[];
  v_unavailable_ids uuid[];
  v_subtotal numeric;
  v_order_id uuid;
  v_order_number text;
begin
  if p_product_ids is null or array_length(p_product_ids, 1) is null then
    raise exception 'Le panier est vide';
  end if;

  v_reseller_id := public.current_reseller_id();
  if v_reseller_id is null then
    raise exception 'Aucun compte revendeur actif associé à cet utilisateur';
  end if;

  select discount_percent into v_discount from public.resellers where id = v_reseller_id;
  select email into v_email from public.profiles where id = auth.uid();

  -- Vente directe et atomique : seuls les produits encore "for-sale-online"
  -- au moment exact de cet UPDATE sont vendus.
  with reserved as (
    update public.products
    set status = 'sold-b2b',
        reserved_by_reseller_id = v_reseller_id,
        reserved_at = now()
    where id = any(p_product_ids)
      and status = 'for-sale-online'
    returning id
  )
  select array_agg(id) into v_reserved_ids from reserved;

  select array_agg(pid) into v_unavailable_ids
  from unnest(p_product_ids) as pid
  where pid <> all (coalesce(v_reserved_ids, array[]::uuid[]));

  if v_unavailable_ids is not null and array_length(v_unavailable_ids, 1) > 0 then
    raise exception 'B2B_UNAVAILABLE_ITEMS:%', array_to_json(v_unavailable_ids)::text;
  end if;

  select coalesce(sum(round(p.sale_price * (1 - v_discount / 100.0), 2)), 0)
  into v_subtotal
  from public.products p
  where p.id = any(v_reserved_ids);

  v_order_number := 'B2B-' || to_char(now(), 'YYYYMMDDHH24MISS') || '-' || substr(v_reseller_id::text, 1, 4);

  insert into public.orders (
    order_number, email, status, total_amount, subtotal, shipping_cost, currency,
    payment_status, shipping_address, billing_address,
    reseller_id, order_channel, approval_status, approved_at
  ) values (
    v_order_number, v_email, 'confirmed', v_subtotal, v_subtotal, 0, 'EUR',
    'pending', p_shipping_address, coalesce(p_billing_address, p_shipping_address),
    v_reseller_id, 'b2b', 'approved', now()
  )
  returning id into v_order_id;

  insert into public.order_items (order_id, product_id, quantity, unit_price, line_total, product_snapshot)
  select
    v_order_id,
    p.id,
    1,
    round(p.sale_price * (1 - v_discount / 100.0), 2),
    round(p.sale_price * (1 - v_discount / 100.0), 2),
    to_jsonb(p.*)
  from public.products p
  where p.id = any(v_reserved_ids);

  update public.products
  set reserved_by_order_id = v_order_id
  where id = any(v_reserved_ids);

  return jsonb_build_object('order_id', v_order_id, 'order_number', v_order_number, 'subtotal', v_subtotal);
end;
$$;
