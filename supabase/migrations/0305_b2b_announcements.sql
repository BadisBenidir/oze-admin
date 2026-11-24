-- ============================================================================
-- Actualités B2B : affiche (image) montrée en fenêtre à la connexion au
-- portail revendeur, gérée par l'admin (Espace B2B → Actualités).
--   - b2b_announcements : image, titre, lien facultatif, période, actif ;
--   - b2b_announcement_views : une ligne quand l'utilisateur ferme l'affiche,
--     elle ne lui est plus montrée ensuite (une fois par personne).
-- ============================================================================

create table if not exists public.b2b_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  image_url text not null,
  link_url text,
  link_label text,
  is_active boolean not null default true,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null
);

create index if not exists b2b_announcements_active_idx on public.b2b_announcements (is_active, starts_at desc);

alter table public.b2b_announcements enable row level security;

drop policy if exists b2b_announcements_admin_all on public.b2b_announcements;
create policy b2b_announcements_admin_all on public.b2b_announcements
  for all using (public.is_admin()) with check (public.is_admin());

-- Les comptes connectés ne voient que les affiches en cours.
drop policy if exists b2b_announcements_read_live on public.b2b_announcements;
create policy b2b_announcements_read_live on public.b2b_announcements
  for select to authenticated
  using (is_active and starts_at <= now() and (ends_at is null or ends_at > now()));

create table if not exists public.b2b_announcement_views (
  announcement_id uuid not null references public.b2b_announcements (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (announcement_id, profile_id)
);

alter table public.b2b_announcement_views enable row level security;

drop policy if exists b2b_announcement_views_own_select on public.b2b_announcement_views;
create policy b2b_announcement_views_own_select on public.b2b_announcement_views
  for select using (profile_id = auth.uid() or public.is_admin());

drop policy if exists b2b_announcement_views_own_insert on public.b2b_announcement_views;
create policy b2b_announcement_views_own_insert on public.b2b_announcement_views
  for insert to authenticated with check (profile_id = auth.uid());

notify pgrst, 'reload schema';
