-- ============================================================================
-- Module B2B Revendeurs — 11 : reconstruction complète et idempotente
--
-- À exécuter si "relation resellers does not exist" (ou toute erreur de
-- colonne manquante) apparaît. Ce script est sûr à relancer plusieurs fois :
-- tout est en CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS /
-- CREATE OR REPLACE. Il ne supprime ni ne modifie aucune donnée existante.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. resellers
-- ----------------------------------------------------------------------------
create table if not exists public.resellers (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  legal_id text,
  status text not null default 'pending' check (status in ('pending', 'active', 'suspended')),
  contact_email text,
  contact_phone text,
  billing_address jsonb,
  address text,
  postal_code text,
  city text,
  country text default 'France',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Filet de sécurité si la table existe déjà mais qu'il manque des colonnes.
alter table public.resellers add column if not exists legal_id text;
alter table public.resellers add column if not exists status text not null default 'pending';
alter table public.resellers add column if not exists contact_email text;
alter table public.resellers add column if not exists contact_phone text;
alter table public.resellers add column if not exists billing_address jsonb;
alter table public.resellers add column if not exists address text;
alter table public.resellers add column if not exists postal_code text;
alter table public.resellers add column if not exists city text;
alter table public.resellers add column if not exists country text default 'France';
alter table public.resellers add column if not exists notes text;
alter table public.resellers add column if not exists created_at timestamptz not null default now();
alter table public.resellers add column if not exists updated_at timestamptz not null default now();

create index if not exists resellers_status_idx on public.resellers (status);

-- ----------------------------------------------------------------------------
-- 2. reseller_contacts
-- ----------------------------------------------------------------------------
create table if not exists public.reseller_contacts (
  id uuid primary key default gen_random_uuid(),
  reseller_id uuid not null references public.resellers (id) on delete cascade,
  profile_id uuid not null unique references public.profiles (id) on delete cascade,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists reseller_contacts_reseller_id_idx on public.reseller_contacts (reseller_id);

-- ----------------------------------------------------------------------------
-- 3. profiles.role : ajouter 'reseller' si pas déjà fait
-- ----------------------------------------------------------------------------
do $$
declare
  cname text;
begin
  select conname into cname
  from pg_constraint
  where conrelid = 'public.profiles'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%role%';

  if cname is not null then
    execute format('alter table public.profiles drop constraint %I', cname);
  end if;

  alter table public.profiles
    add constraint profiles_role_check check (role in ('admin', 'client', 'reseller'));
exception when others then
  -- si role est un enum natif plutôt qu'une contrainte texte, ce bloc échoue
  -- silencieusement : vérifier manuellement dans ce cas (voir message ci-dessous).
  raise notice 'Impossible d''ajouter la contrainte sur profiles.role automatiquement — vérifier si role est un enum natif.';
end $$;

-- ----------------------------------------------------------------------------
-- 4. products : colonnes de réservation + statuts B2B
-- ----------------------------------------------------------------------------
alter table public.products
  add column if not exists reserved_by_reseller_id uuid references public.resellers (id),
  add column if not exists reserved_by_order_id uuid,
  add column if not exists reserved_at timestamptz;

create index if not exists products_reserved_by_reseller_id_idx on public.products (reserved_by_reseller_id);

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

-- ----------------------------------------------------------------------------
-- 5. orders : canal B2B + workflow + Stripe
-- ----------------------------------------------------------------------------
alter table public.orders
  add column if not exists reseller_id uuid references public.resellers (id),
  add column if not exists order_channel text not null default 'web' check (order_channel in ('web', 'b2b')),
  add column if not exists approval_status text check (approval_status in ('pending_approval', 'approved', 'rejected')),
  add column if not exists approved_by uuid references public.profiles (id),
  add column if not exists approved_at timestamptz,
  add column if not exists rejection_reason text,
  add column if not exists stripe_session_id text,
  add column if not exists stripe_payment_intent_id text;

create index if not exists orders_reseller_id_idx on public.orders (reseller_id);
create index if not exists orders_order_channel_idx on public.orders (order_channel);
create index if not exists orders_approval_status_idx on public.orders (approval_status);

-- ----------------------------------------------------------------------------
-- 6. Fonctions utilitaires
-- ----------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.current_reseller_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select rc.reseller_id
  from public.reseller_contacts rc
  join public.resellers rs on rs.id = rc.reseller_id
  where rc.profile_id = auth.uid() and rs.status = 'active'
  limit 1;
$$;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.current_reseller_id() to authenticated;

-- ----------------------------------------------------------------------------
-- 7. RLS
-- ----------------------------------------------------------------------------
alter table public.resellers enable row level security;

drop policy if exists resellers_admin_all on public.resellers;
create policy resellers_admin_all on public.resellers
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists resellers_reseller_select_own on public.resellers;
create policy resellers_reseller_select_own on public.resellers
  for select using (id = public.current_reseller_id());

alter table public.reseller_contacts enable row level security;

drop policy if exists reseller_contacts_admin_all on public.reseller_contacts;
create policy reseller_contacts_admin_all on public.reseller_contacts
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists reseller_contacts_reseller_select_own on public.reseller_contacts;
create policy reseller_contacts_reseller_select_own on public.reseller_contacts
  for select using (reseller_id = public.current_reseller_id());

drop policy if exists reseller_contacts_primary_delete on public.reseller_contacts;
create policy reseller_contacts_primary_delete on public.reseller_contacts
  for delete using (
    reseller_id = public.current_reseller_id()
    and is_primary = false
    and exists (
      select 1 from public.reseller_contacts self
      where self.profile_id = auth.uid()
        and self.is_primary = true
        and self.reseller_id = reseller_contacts.reseller_id
    )
  );

drop policy if exists orders_reseller_select_own on public.orders;
create policy orders_reseller_select_own on public.orders
  for select using (reseller_id = public.current_reseller_id());

drop policy if exists order_items_reseller_select_own on public.order_items;
create policy order_items_reseller_select_own on public.order_items
  for select using (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id
        and o.reseller_id = public.current_reseller_id()
    )
  );

-- ⚠️ Toujours à vérifier manuellement : aucune policy SELECT permissive
-- préexistante sur `products` ne doit exposer purchase_price/internal_comments
-- à un rôle authentifié quelconque (voir Dashboard → Authentication → Policies).

-- ----------------------------------------------------------------------------
-- 8. Vue catalogue B2B
-- ----------------------------------------------------------------------------
drop view if exists public.b2b_catalog;
create view public.b2b_catalog as
select
  p.id, p.product_code, p.reference, p.name, p.brand_id, p.category_id, p.genre,
  p.weight, p.images, p.main_image_index, p.condition, p.description, p.colors,
  p.material, p.status, p.created_at, p.sale_price as price
from public.products p
where p.status = 'for-sale-b2b'
  and exists (
    select 1 from public.reseller_contacts rc
    join public.resellers rs on rs.id = rc.reseller_id
    where rc.profile_id = auth.uid() and rs.status = 'active'
  );

grant select on public.b2b_catalog to authenticated;

-- ----------------------------------------------------------------------------
-- 9. submit_b2b_order (achat instantané) et confirm_b2b_payment (paiement Stripe)
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
    set status = 'sold-b2b', reserved_by_reseller_id = v_reseller_id, reserved_at = now()
    where id = any(p_product_ids) and status = 'for-sale-b2b'
    returning id
  )
  select array_agg(id) into v_reserved_ids from reserved;

  select array_agg(pid) into v_unavailable_ids
  from unnest(p_product_ids) as pid
  where pid <> all (coalesce(v_reserved_ids, array[]::uuid[]));

  if v_unavailable_ids is not null and array_length(v_unavailable_ids, 1) > 0 then
    raise exception 'B2B_UNAVAILABLE_ITEMS:%', array_to_json(v_unavailable_ids)::text;
  end if;

  select coalesce(sum(p.sale_price), 0) into v_subtotal from public.products p where p.id = any(v_reserved_ids);

  v_order_number := 'B2B-' || to_char(now(), 'YYYYMMDDHH24MISS') || '-' || substr(v_reseller_id::text, 1, 4);

  insert into public.orders (
    order_number, email, status, total_amount, subtotal, shipping_cost, currency,
    payment_status, shipping_address, billing_address, reseller_id, order_channel, approval_status, approved_at
  ) values (
    v_order_number, v_email, 'confirmed', v_subtotal, v_subtotal, 0, 'EUR',
    'pending', p_shipping_address, coalesce(p_billing_address, p_shipping_address), v_reseller_id, 'b2b', 'approved', now()
  )
  returning id into v_order_id;

  insert into public.order_items (order_id, product_id, quantity, unit_price, line_total, product_snapshot)
  select v_order_id, p.id, 1, p.sale_price, p.sale_price, to_jsonb(p.*)
  from public.products p where p.id = any(v_reserved_ids);

  update public.products set reserved_by_order_id = v_order_id where id = any(v_reserved_ids);

  return jsonb_build_object('order_id', v_order_id, 'order_number', v_order_number, 'subtotal', v_subtotal);
end;
$$;

create or replace function public.confirm_b2b_payment(
  p_reseller_id uuid,
  p_product_ids uuid[],
  p_shipping_address jsonb,
  p_billing_address jsonb,
  p_stripe_session_id text,
  p_stripe_payment_intent_id text,
  p_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_order_id uuid;
  v_reserved_ids uuid[];
  v_unavailable_ids uuid[];
  v_subtotal numeric;
  v_order_id uuid;
  v_order_number text;
begin
  select id into v_existing_order_id from public.orders where stripe_session_id = p_stripe_session_id;
  if v_existing_order_id is not null then
    return jsonb_build_object('order_id', v_existing_order_id, 'already_processed', true, 'unavailable_ids', '[]'::jsonb);
  end if;

  if p_product_ids is null or array_length(p_product_ids, 1) is null then
    raise exception 'Aucun article dans la commande';
  end if;

  with reserved as (
    update public.products
    set status = 'sold-b2b', reserved_by_reseller_id = p_reseller_id, reserved_at = now()
    where id = any(p_product_ids) and status = 'for-sale-b2b'
    returning id
  )
  select array_agg(id) into v_reserved_ids from reserved;

  select array_agg(pid) into v_unavailable_ids
  from unnest(p_product_ids) as pid
  where pid <> all (coalesce(v_reserved_ids, array[]::uuid[]));

  if v_reserved_ids is null or array_length(v_reserved_ids, 1) is null then
    return jsonb_build_object('order_id', null, 'already_processed', false, 'unavailable_ids', to_jsonb(p_product_ids));
  end if;

  select coalesce(sum(p.sale_price), 0) into v_subtotal from public.products p where p.id = any(v_reserved_ids);

  v_order_number := 'B2B-' || to_char(now(), 'YYYYMMDDHH24MISS') || '-' || substr(p_reseller_id::text, 1, 4);

  insert into public.orders (
    order_number, email, status, total_amount, subtotal, shipping_cost, currency,
    payment_status, shipping_address, billing_address, reseller_id, order_channel, approval_status, approved_at,
    stripe_session_id, stripe_payment_intent_id
  ) values (
    v_order_number, p_email, 'confirmed', v_subtotal, v_subtotal, 0, 'EUR',
    'paid', p_shipping_address, coalesce(p_billing_address, p_shipping_address), p_reseller_id, 'b2b', 'approved', now(),
    p_stripe_session_id, p_stripe_payment_intent_id
  )
  returning id into v_order_id;

  insert into public.order_items (order_id, product_id, quantity, unit_price, line_total, product_snapshot)
  select v_order_id, p.id, 1, p.sale_price, p.sale_price, to_jsonb(p.*)
  from public.products p where p.id = any(v_reserved_ids);

  update public.products set reserved_by_order_id = v_order_id where id = any(v_reserved_ids);

  return jsonb_build_object(
    'order_id', v_order_id, 'already_processed', false, 'subtotal', v_subtotal,
    'unavailable_ids', to_jsonb(coalesce(v_unavailable_ids, array[]::uuid[]))
  );
end;
$$;

revoke all on function public.confirm_b2b_payment(uuid, uuid[], jsonb, jsonb, text, text, text) from public;
revoke all on function public.confirm_b2b_payment(uuid, uuid[], jsonb, jsonb, text, text, text) from authenticated;

-- ----------------------------------------------------------------------------
-- 10. Rapport de chiffre d'affaires B2B (admin uniquement)
-- ----------------------------------------------------------------------------
drop view if exists public.b2b_order_margins;
drop view if exists public.b2b_reseller_revenue;
create view public.b2b_reseller_revenue as
select o.id as order_id, o.reseller_id, o.created_at, o.subtotal
from public.orders o
where o.order_channel = 'b2b' and public.is_admin();

grant select on public.b2b_reseller_revenue to authenticated;

notify pgrst, 'reload schema';
