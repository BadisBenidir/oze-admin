-- ============================================================================
-- Système d'enchères en direct hebdomadaires — accès volontairement caché
-- (aucun onglet de nav, aucune page admin dans cette première passe) : les
-- sessions/lots doivent être créés à la main via le dashboard Supabase pour
-- l'instant. La confidentialité réelle vient d'ici (RLS), pas du code
-- d'accès côté client (voir ResellerApp.tsx) qui n'est qu'un simple filtre
-- de confort — un identifiant compilé dans le bundle JS n'est jamais un
-- vrai secret.
--
-- Convention reprise de tout le reste du schéma (jamais dérogée ailleurs
-- dans ce repo) : les FK vers "l'utilisateur" pointent public.profiles(id),
-- pas auth.users(id) directement — profiles.id = auth.uid() partout.
-- ============================================================================

create table if not exists public.auction_sessions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'upcoming' check (status in ('upcoming', 'live', 'closed')),
  created_at timestamptz not null default now()
);

create table if not exists public.auction_items (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.auction_sessions (id) on delete cascade,
  title text not null,
  brand text not null,
  grade text not null,
  images text[] not null default '{}',
  start_price numeric(10, 2) not null check (start_price >= 0),
  current_price numeric(10, 2) not null check (current_price >= 0),
  min_increment numeric(10, 2) not null default 5.00 check (min_increment > 0),
  reserve_price numeric(10, 2) check (reserve_price is null or reserve_price >= 0),
  current_winner_id uuid references public.profiles (id) on delete set null,
  ends_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'sold', 'unsold')),
  created_at timestamptz not null default now()
);

create table if not exists public.auction_bids (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.auction_items (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  amount numeric(10, 2) not null check (amount > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.auction_access (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  session_id uuid references public.auction_sessions (id) on delete set null,
  access_type text not null check (access_type in ('weekly_pass', 'monthly_sub')),
  valid_until timestamptz not null,
  price_paid numeric(10, 2) not null check (price_paid >= 0),
  created_at timestamptz not null default now()
);

-- Table préparée pour une future passerelle de paiement (pass hebdo/abo
-- mensuel) — non exploitée par la RLS ci-dessous pour l'instant : la
-- gater dès maintenant condamnerait la fonctionnalité entière puisqu'elle
-- serait vide (aucun flux d'achat n'existe encore pour la remplir). Tout
-- revendeur authentifié peut donc lire les sessions/lots ; si un contrôle
-- d'accès payant par personne est voulu plus tard, resserrer les policies
-- ci-dessous pour exiger une ligne auction_access valide.
create index if not exists auction_items_session_id_idx on public.auction_items (session_id);
create index if not exists auction_bids_item_id_idx on public.auction_bids (item_id);
create index if not exists auction_bids_user_id_idx on public.auction_bids (user_id);
create index if not exists auction_access_user_id_idx on public.auction_access (user_id);
create index if not exists auction_access_session_id_idx on public.auction_access (session_id);

alter table public.auction_sessions enable row level security;
alter table public.auction_items enable row level security;
alter table public.auction_bids enable row level security;
alter table public.auction_access enable row level security;

drop policy if exists auction_sessions_admin_all on public.auction_sessions;
create policy auction_sessions_admin_all on public.auction_sessions
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists auction_items_admin_all on public.auction_items;
create policy auction_items_admin_all on public.auction_items
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists auction_bids_admin_all on public.auction_bids;
create policy auction_bids_admin_all on public.auction_bids
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists auction_access_admin_all on public.auction_access;
create policy auction_access_admin_all on public.auction_access
  for all using (public.is_admin()) with check (public.is_admin());

-- Revendeur authentifié : lecture des sessions/lots/enchères, et création
-- de SES PROPRES enchères uniquement (jamais au nom d'un autre profil).
drop policy if exists auction_sessions_reseller_select on public.auction_sessions;
create policy auction_sessions_reseller_select on public.auction_sessions
  for select using (public.current_reseller_id() is not null);

drop policy if exists auction_items_reseller_select on public.auction_items;
create policy auction_items_reseller_select on public.auction_items
  for select using (public.current_reseller_id() is not null);

drop policy if exists auction_bids_reseller_select on public.auction_bids;
create policy auction_bids_reseller_select on public.auction_bids
  for select using (public.current_reseller_id() is not null);

drop policy if exists auction_bids_reseller_insert on public.auction_bids;
create policy auction_bids_reseller_insert on public.auction_bids
  for insert with check (user_id = auth.uid() and public.current_reseller_id() is not null);

revoke all on public.auction_sessions, public.auction_items, public.auction_bids, public.auction_access from public, authenticated;
grant select on public.auction_sessions, public.auction_items, public.auction_bids to authenticated;
grant insert on public.auction_bids to authenticated;

-- ----------------------------------------------------------------------------
-- handle_new_bid : valide et applique chaque enchère avant même son
-- insertion (BEFORE INSERT — un montant invalide n'est jamais écrit) :
--   - verrouille la ligne auction_items (FOR UPDATE) pour sérialiser deux
--     enchères concurrentes sur le même lot — la seconde relit forcément le
--     current_price déjà mis à jour par la première avant sa propre
--     vérification, aucune fenêtre de double-dépense.
--   - rejette si l'article n'est pas actif, si le temps est écoulé, ou si
--     le montant est inférieur à current_price + min_increment.
--   - "soft close" : si moins de 5 minutes restent, repousse ends_at à
--     maintenant + 5 minutes (anti-sniping).
--   - répercute immédiatement current_price / current_winner_id sur le lot.
-- SECURITY DEFINER : un revendeur n'a que SELECT sur auction_items via RLS
-- (jamais UPDATE) — nécessaire pour que ce trigger puisse mettre à jour le
-- lot à sa place, sans lui donner ce droit directement.
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_bid()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item record;
begin
  select * into v_item from public.auction_items where id = new.item_id for update;

  if v_item is null then
    raise exception 'Article introuvable';
  end if;
  if v_item.status <> 'active' then
    raise exception 'Cette enchère est terminée';
  end if;
  if v_item.ends_at <= now() then
    raise exception 'Le temps est écoulé pour cet article';
  end if;
  if new.amount < v_item.current_price + v_item.min_increment then
    raise exception 'Montant insuffisant : minimum % €', to_char(v_item.current_price + v_item.min_increment, 'FM999999990.00');
  end if;

  update public.auction_items
  set current_price = new.amount,
      current_winner_id = new.user_id,
      ends_at = case when v_item.ends_at - now() < interval '5 minutes' then now() + interval '5 minutes' else v_item.ends_at end
  where id = new.item_id;

  return new;
end;
$$;

drop trigger if exists on_new_auction_bid on public.auction_bids;
create trigger on_new_auction_bid
before insert on public.auction_bids
for each row execute function public.handle_new_bid();

notify pgrst, 'reload schema';
