-- ============================================================================
-- Module B2B Revendeurs — 4/4 : RPC SECURITY DEFINER
--
-- Toute création/validation de commande B2B passe par ces fonctions (jamais
-- par une écriture directe côté client sur products/orders/order_items) :
--   - le prix est toujours recalculé côté serveur à partir de
--     products.sale_price et resellers.discount_percent, jamais accepté
--     depuis le client ;
--   - la réservation des pièces uniques est atomique (UPDATE conditionnel
--     dans la même transaction que la création de la commande — toute
--     indisponibilité partielle fait un ROLLBACK complet via RAISE EXCEPTION).
-- ============================================================================

grant execute on function public.is_admin() to authenticated;
grant execute on function public.current_reseller_id() to authenticated;

-- ----------------------------------------------------------------------------
-- submit_b2b_order — soumission du panier revendeur
-- ----------------------------------------------------------------------------
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

  -- Réservation atomique : seuls les produits encore "for-sale-online" au
  -- moment exact de cet UPDATE sont verrouillés. C'est ce qui empêche deux
  -- revendeurs (ou un revendeur et le site public) d'acheter la même pièce.
  with reserved as (
    update public.products
    set status = 'reserved-b2b',
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
    -- Annule aussi la réservation partielle faite juste au-dessus : une
    -- exception non interceptée fait un ROLLBACK de toute la transaction.
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
    reseller_id, order_channel, approval_status
  ) values (
    v_order_number, v_email, 'pending', v_subtotal, v_subtotal, 0, 'EUR',
    'pending', p_shipping_address, coalesce(p_billing_address, p_shipping_address),
    v_reseller_id, 'b2b', 'pending_approval'
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

grant execute on function public.submit_b2b_order(uuid[], jsonb, jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- approve_b2b_order — validation admin d'une commande B2B en attente
-- ----------------------------------------------------------------------------
create or replace function public.approve_b2b_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_channel text;
  v_approval text;
begin
  if not public.is_admin() then
    raise exception 'Accès refusé : réservé aux administrateurs';
  end if;

  select order_channel, approval_status into v_channel, v_approval
  from public.orders where id = p_order_id
  for update;

  if v_channel is null then
    raise exception 'Commande introuvable';
  end if;
  if v_channel <> 'b2b' then
    raise exception 'Cette commande n''est pas une commande B2B';
  end if;
  if v_approval <> 'pending_approval' then
    raise exception 'Cette commande n''est plus en attente de validation (statut actuel : %)', v_approval;
  end if;

  update public.orders
  set approval_status = 'approved',
      approved_by = auth.uid(),
      approved_at = now(),
      status = 'confirmed'
  where id = p_order_id;

  update public.products
  set status = 'sold-b2b'
  where reserved_by_order_id = p_order_id;
end;
$$;

grant execute on function public.approve_b2b_order(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- reject_b2b_order — rejet admin, libère les pièces réservées vers le catalogue
-- ----------------------------------------------------------------------------
create or replace function public.reject_b2b_order(p_order_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_channel text;
  v_approval text;
begin
  if not public.is_admin() then
    raise exception 'Accès refusé : réservé aux administrateurs';
  end if;

  select order_channel, approval_status into v_channel, v_approval
  from public.orders where id = p_order_id
  for update;

  if v_channel is null then
    raise exception 'Commande introuvable';
  end if;
  if v_channel <> 'b2b' then
    raise exception 'Cette commande n''est pas une commande B2B';
  end if;
  if v_approval <> 'pending_approval' then
    raise exception 'Cette commande n''est plus en attente de validation (statut actuel : %)', v_approval;
  end if;

  update public.orders
  set approval_status = 'rejected',
      rejection_reason = p_reason,
      status = 'cancelled'
  where id = p_order_id;

  update public.products
  set status = 'for-sale-online',
      reserved_by_reseller_id = null,
      reserved_by_order_id = null,
      reserved_at = null
  where reserved_by_order_id = p_order_id;
end;
$$;

grant execute on function public.reject_b2b_order(uuid, text) to authenticated;
