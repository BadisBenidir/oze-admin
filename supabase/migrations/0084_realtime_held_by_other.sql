-- ============================================================================
-- Corrige held_by_other (vues b2b_catalog / b2b_reseller_product_detail) :
-- elles le calculaient encore depuis public.b2b_cart_holds, un mécanisme de
-- verrou devenu mort depuis que useB2BCart.ts a été migré vers la vraie
-- réservation exclusive cart_items / cart_add_item (plus rien n'appelle
-- jamais hold_b2b_cart_item côté client désormais) — held_by_other restait
-- donc figé à false en pratique : aucune carte catalogue ne se grisait plus
-- quand un autre revendeur réservait un article.
--
-- Ajoute aussi product_reservation_signals, une table minimale lisible par
-- tout revendeur actif (product_id + horodatage d'expiration UNIQUEMENT,
-- jamais qui a réservé), maintenue par trigger sur cart_items et exposée en
-- Realtime : cart_items a lui-même une RLS stricte (user_id = auth.uid()),
-- donc un abonnement Realtime postgres_changes direct sur cart_items ne
-- notifierait JAMAIS un revendeur des réservations faites par un AUTRE
-- (le serveur Realtime applique la RLS de la table source au moment de
-- diffuser chaque événement à chaque abonné, indépendamment de ce qu'une vue
-- côté SQL peut voir) — une table séparée, lisible par tous les revendeurs
-- actifs, est nécessaire pour que le signal traverse jusqu'au navigateur.
-- ============================================================================

create table if not exists public.product_reservation_signals (
  product_id uuid primary key references public.products (id) on delete cascade,
  reserved_until timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public.product_reservation_signals enable row level security;

drop policy if exists "product_reservation_signals_select_reseller" on public.product_reservation_signals;
create policy "product_reservation_signals_select_reseller" on public.product_reservation_signals
  for select using (
    exists (
      select 1 from public.reseller_contacts rc
      join public.resellers rs on rs.id = rc.reseller_id
      where rc.profile_id = auth.uid() and rs.status = 'active'
    )
  );

-- Aucune policy insert/update/delete pour authenticated/anon : seul le
-- trigger SECURITY DEFINER ci-dessous (propriétaire de la fonction,
-- contourne RLS) écrit cette table.
revoke insert, update, delete on public.product_reservation_signals from authenticated, anon;
grant select on public.product_reservation_signals to authenticated;

create or replace function public.sync_product_reservation_signal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    -- product_id est UNIQUE sur cart_items (cart_items_product_id_unique) :
    -- au plus une réservation active par produit à la fois, rien d'autre à
    -- réconcilier ici.
    delete from public.product_reservation_signals where product_id = old.product_id;
    return old;
  end if;

  if new.expires_at is null then
    -- Ne devrait jamais arriver (cart_add_item fixe toujours une expiration
    -- future) : traité comme "plus réservé" plutôt que de violer la
    -- contrainte not null sur reserved_until et faire échouer la
    -- transaction appelante (cart_add_item/cart_remove_item).
    delete from public.product_reservation_signals where product_id = new.product_id;
    return new;
  end if;

  insert into public.product_reservation_signals (product_id, reserved_until, updated_at)
  values (new.product_id, new.expires_at, now())
  on conflict (product_id) do update
    set reserved_until = excluded.reserved_until, updated_at = now();
  return new;
end;
$$;

drop trigger if exists cart_items_sync_reservation_signal on public.cart_items;
create trigger cart_items_sync_reservation_signal
after insert or update or delete on public.cart_items
for each row execute function public.sync_product_reservation_signal();

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'product_reservation_signals'
  ) then
    alter publication supabase_realtime add table public.product_reservation_signals;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- held_by_other recalculé directement depuis cart_items (la vraie réservation
-- exclusive) plutôt que b2b_cart_holds. Ces deux vues sont possédées par le
-- rôle de migration (contourne RLS), donc peuvent lire cart_items au-delà de
-- sa policy select "user_id = auth.uid()" — exactement comme elles le
-- faisaient déjà pour b2b_cart_holds ; seul le `<> auth.uid()` explicite
-- ci-dessous fournit la sémantique par-utilisateur (jamais la RLS de la
-- table elle-même dans ce contexte).
-- ----------------------------------------------------------------------------
create or replace view public.b2b_catalog as
select
  p.id, p.product_code, p.reference, p.b2b_reference, p.name, p.brand_id, p.category_id, p.genre,
  p.weight, p.images, p.main_image_index, p.condition, p.description, p.colors,
  p.material, p.status, p.created_at, p.sale_price as price,
  p.defects, p.defect_images,
  exists (
    select 1 from public.cart_items ci
    where ci.product_id = p.id
      and ci.user_id <> auth.uid()
      and ci.expires_at is not null and ci.expires_at > now()
  ) as held_by_other,
  p.original_price
from public.products p
where p.status = 'for-sale-b2b'
  and exists (
    select 1 from public.reseller_contacts rc
    join public.resellers rs on rs.id = rc.reseller_id
    where rc.profile_id = auth.uid() and rs.status = 'active'
  );

grant select on public.b2b_catalog to authenticated;

create or replace view public.b2b_reseller_product_detail as
select
  p.id, p.product_code, p.reference, p.b2b_reference, p.name, p.brand_id, p.category_id, p.genre,
  p.weight, p.images, p.main_image_index, p.condition, p.description, p.colors,
  p.material, p.status, p.created_at, p.sale_price as price,
  p.defects, p.defect_images,
  exists (
    select 1 from public.cart_items ci
    where ci.product_id = p.id
      and ci.user_id <> auth.uid()
      and ci.expires_at is not null and ci.expires_at > now()
  ) as held_by_other,
  p.original_price
from public.products p
where (
  p.status = 'for-sale-b2b'
  and exists (
    select 1 from public.reseller_contacts rc
    join public.resellers rs on rs.id = rc.reseller_id
    where rc.profile_id = auth.uid() and rs.status = 'active'
  )
)
or exists (
  select 1
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where oi.product_id = p.id
    and o.reseller_id = public.current_reseller_id()
);

grant select on public.b2b_reseller_product_detail to authenticated;

notify pgrst, 'reload schema';
