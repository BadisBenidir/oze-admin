-- ============================================================================
-- Module B2B Revendeurs — 1/4 : schéma (tables, colonnes, fonctions utilitaires)
-- À exécuter manuellement dans l'éditeur SQL Supabase, dans l'ordre 0001→0004.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. profiles.role : ajouter la valeur 'reseller'
--
-- ⚠️ VÉRIFICATION MANUELLE REQUISE avant d'exécuter cette section : on ne sait
-- pas depuis ce dépôt si `role` est un type enum Postgres natif ou une colonne
-- text/varchar avec une contrainte CHECK. Lancez d'abord :
--
--   select column_name, data_type, udt_name
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'profiles' and column_name = 'role';
--
-- Si data_type = 'USER-DEFINED' → c'est un enum, utilisez le BLOC A.
-- Sinon (text/character varying) → utilisez le BLOC B.
-- Ne lancez qu'UN SEUL des deux blocs ci-dessous (commentez l'autre).
-- ----------------------------------------------------------------------------

-- BLOC A — si `role` est un enum Postgres natif (remplacez enum_role_type par
-- la valeur trouvée dans `udt_name` ci-dessus) :
-- alter type enum_role_type add value if not exists 'reseller';

-- BLOC B — si `role` est text/varchar (+ éventuelle contrainte CHECK) :
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
end $$;

-- ----------------------------------------------------------------------------
-- 2. resellers — le compte entreprise du revendeur
-- ----------------------------------------------------------------------------
create table if not exists public.resellers (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  legal_id text,                          -- SIRET / n° TVA intracommunautaire
  status text not null default 'pending' check (status in ('pending', 'active', 'suspended')),
  discount_percent numeric(5, 2) not null default 0 check (discount_percent between 0 and 100),
  contact_email text,
  contact_phone text,
  billing_address jsonb,
  notes text,                             -- admin only, jamais exposé au revendeur
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists resellers_status_idx on public.resellers (status);

-- ----------------------------------------------------------------------------
-- 3. reseller_contacts — lien profiles ↔ resellers (plusieurs logins/entreprise)
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
-- 4. products — colonnes de réservation + nouveaux statuts B2B
-- ----------------------------------------------------------------------------
alter table public.products
  add column if not exists reserved_by_reseller_id uuid references public.resellers (id),
  add column if not exists reserved_by_order_id uuid,
  add column if not exists reserved_at timestamptz;

create index if not exists products_reserved_by_reseller_id_idx on public.products (reserved_by_reseller_id);

-- Étend la contrainte CHECK existante sur `status` (nom de contrainte inconnu
-- depuis ce dépôt, donc on la retrouve dynamiquement avant de la remplacer).
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
      'reserved-b2b', 'sold-b2b'
    ));
end $$;

-- ----------------------------------------------------------------------------
-- 5. orders — colonnes du canal B2B et du workflow d'approbation
-- ----------------------------------------------------------------------------
alter table public.orders
  add column if not exists reseller_id uuid references public.resellers (id),
  add column if not exists order_channel text not null default 'web' check (order_channel in ('web', 'b2b')),
  add column if not exists approval_status text check (approval_status in ('pending_approval', 'approved', 'rejected')),
  add column if not exists approved_by uuid references public.profiles (id),
  add column if not exists approved_at timestamptz,
  add column if not exists rejection_reason text;

create index if not exists orders_reseller_id_idx on public.orders (reseller_id);
create index if not exists orders_order_channel_idx on public.orders (order_channel);
create index if not exists orders_approval_status_idx on public.orders (approval_status);

-- ----------------------------------------------------------------------------
-- 6. Fonctions utilitaires (SECURITY DEFINER, réutilisées par les policies RLS
--    du fichier 0002 et les RPC du fichier 0004 — évite la récursion RLS).
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

-- ----------------------------------------------------------------------------
-- 7. Rapport de marge B2B — vue dérivée, aucune donnée stockée séparément.
--    (OZË ne verse rien au revendeur ; « commission » = remise déjà accordée,
--    visible en comparant le prix payé au prix catalogue au moment de l'achat.)
-- ----------------------------------------------------------------------------
create or replace view public.b2b_order_margins as
select
  o.id as order_id,
  o.reseller_id,
  o.created_at,
  o.subtotal as wholesale_subtotal,
  coalesce(sum((oi.product_snapshot ->> 'sale_price')::numeric * oi.quantity), 0) as catalog_subtotal
from public.orders o
join public.order_items oi on oi.order_id = o.id
-- ⚠️ Cette vue est possédée par `postgres` (comportement par défaut à la
-- création), donc elle contourne le RLS de `orders`/`order_items` par défaut.
-- Le `and public.is_admin()` ci-dessous est donc INDISPENSABLE : sans lui,
-- n'importe quel revendeur connecté pourrait lire les marges de TOUS les
-- revendeurs (pas seulement les siennes) en interrogeant cette vue.
where o.order_channel = 'b2b'
  and public.is_admin()
group by o.id, o.reseller_id, o.created_at, o.subtotal;

grant select on public.b2b_order_margins to authenticated;
