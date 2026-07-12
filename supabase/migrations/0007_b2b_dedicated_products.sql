-- ============================================================================
-- Module B2B Revendeurs — 7 : produits dédiés B2B, prix fixé à la création
--
-- Changement de modèle : les produits B2B ne sont PAS les mêmes que ceux du
-- site public (pas de remise calculée sur un prix "catalogue"). Ce sont des
-- pièces distinctes, marquées `status = 'for-sale-b2b'` dès leur création,
-- avec un `sale_price` qui EST directement le prix payé par le revendeur —
-- aucun calcul de remise. Un produit ne peut avoir qu'un seul statut à la
-- fois (`for-sale-online` OU `for-sale-b2b`), ce qui garantit nativement
-- qu'aucune pièce B2B n'apparaît sur le site public.
--
-- `resellers.discount_percent` n'a donc plus de sens (le prix n'est plus une
-- remise sur un prix public) et est supprimé.
-- ============================================================================

-- 1. Nouveau statut produit "for-sale-b2b"
do $$
declare
  cname text;
begin
  select conname into cname
  from pg_constraint
  where conrelid = 'public.products'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%status%';

  if cname is not null then
    execute format('alter table public.products drop constraint %I', cname);
  end if;

  alter table public.products
    add constraint products_status_check check (status in (
      'draft', 'for-sale-online', 'for-sale-other-platform', 'sold-online',
      'sold-other-platform', 'sold-display', 'for-auction-live', 'sold-auction',
      'for-sale-b2b', 'reserved-b2b', 'sold-b2b'
    ));
end $$;

-- 2. Vue catalogue B2B : prix direct, plus de calcul de remise
create or replace view public.b2b_catalog as
select
  p.id,
  p.product_code,
  p.reference,
  p.name,
  p.brand_id,
  p.category_id,
  p.genre,
  p.weight,
  p.images,
  p.main_image_index,
  p.condition,
  p.description,
  p.colors,
  p.material,
  p.status,
  p.created_at,
  p.sale_price as price
from public.products p
where p.status = 'for-sale-b2b'
  and exists (
    select 1 from public.reseller_contacts rc
    join public.resellers rs on rs.id = rc.reseller_id
    where rc.profile_id = auth.uid() and rs.status = 'active'
  );

grant select on public.b2b_catalog to authenticated;

-- 3. submit_b2b_order : réserve/vend depuis le pool "for-sale-b2b", prix direct
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

  select email into v_email from public.profiles where id = auth.uid();

  with reserved as (
    update public.products
    set status = 'sold-b2b',
        reserved_by_reseller_id = v_reseller_id,
        reserved_at = now()
    where id = any(p_product_ids)
      and status = 'for-sale-b2b'
    returning id
  )
  select array_agg(id) into v_reserved_ids from reserved;

  select array_agg(pid) into v_unavailable_ids
  from unnest(p_product_ids) as pid
  where pid <> all (coalesce(v_reserved_ids, array[]::uuid[]));

  if v_unavailable_ids is not null and array_length(v_unavailable_ids, 1) > 0 then
    raise exception 'B2B_UNAVAILABLE_ITEMS:%', array_to_json(v_unavailable_ids)::text;
  end if;

  select coalesce(sum(p.sale_price), 0)
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
    p.sale_price,
    p.sale_price,
    to_jsonb(p.*)
  from public.products p
  where p.id = any(v_reserved_ids);

  update public.products
  set reserved_by_order_id = v_order_id
  where id = any(v_reserved_ids);

  return jsonb_build_object('order_id', v_order_id, 'order_number', v_order_number, 'subtotal', v_subtotal);
end;
$$;

-- 4. Rapport "Commissions" simplifié en chiffre d'affaires B2B par revendeur
--    (il n'y a plus de "prix catalogue" à comparer puisque les produits B2B
--    ne sont jamais vendus au grand public).
drop view if exists public.b2b_order_margins;
create or replace view public.b2b_reseller_revenue as
select
  o.id as order_id,
  o.reseller_id,
  o.created_at,
  o.subtotal
from public.orders o
where o.order_channel = 'b2b'
  and public.is_admin();

grant select on public.b2b_reseller_revenue to authenticated;

-- 5. resellers.discount_percent n'a plus d'usage
alter table public.resellers drop column if exists discount_percent;
