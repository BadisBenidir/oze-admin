-- ============================================================================
-- Module B2B Revendeurs — 30 : lien d'invitation d'équipe réutilisable
--
-- Complète invite-reseller-contact (création un par un, admin/contact
-- principal) avec un lien unique que le contact principal peut copier-coller
-- et transmettre à plusieurs collègues : chacun s'inscrit lui-même via
-- /invite/team?token=..., sans qu'un admin ou le contact principal ait à
-- saisir chaque compte individuellement.
-- ============================================================================

create table if not exists public.reseller_invite_links (
  id uuid primary key default gen_random_uuid(),
  reseller_id uuid not null references public.resellers (id) on delete cascade,
  token text not null unique default (
    replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
  ),
  is_active boolean not null default true,
  max_uses integer check (max_uses is null or max_uses > 0),
  use_count integer not null default 0,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists reseller_invite_links_reseller_id_idx on public.reseller_invite_links (reseller_id);

alter table public.reseller_invite_links enable row level security;

drop policy if exists reseller_invite_links_admin_all on public.reseller_invite_links;
create policy reseller_invite_links_admin_all on public.reseller_invite_links
  for all using (public.is_admin()) with check (public.is_admin());

-- Le contact principal gère les liens de sa propre entreprise (tant qu'elle est active).
drop policy if exists reseller_invite_links_primary_all on public.reseller_invite_links;
create policy reseller_invite_links_primary_all on public.reseller_invite_links
  for all using (
    reseller_id = public.current_reseller_id()
    and exists (
      select 1 from public.reseller_contacts rc
      where rc.profile_id = auth.uid() and rc.reseller_id = reseller_invite_links.reseller_id and rc.is_primary
    )
  )
  with check (
    reseller_id = public.current_reseller_id()
    and exists (
      select 1 from public.reseller_contacts rc
      where rc.profile_id = auth.uid() and rc.reseller_id = reseller_invite_links.reseller_id and rc.is_primary
    )
  );

-- Lecture publique (anon, avant toute auth) du nom de société + validité d'un
-- token, pour l'affichage sur /invite/team. SECURITY DEFINER : contourne le
-- RLS ci-dessus (sinon anon ne verrait rien), ne renvoie que 2 colonnes.
create or replace function public.get_reseller_invite_info(p_token text)
returns table(company_name text, is_valid boolean)
language sql
security definer
set search_path = public
as $$
  select
    r.company_name,
    (l.is_active and r.status = 'active' and (l.max_uses is null or l.use_count < l.max_uses)) as is_valid
  from public.reseller_invite_links l
  join public.resellers r on r.id = l.reseller_id
  where l.token = p_token
$$;

grant execute on function public.get_reseller_invite_info(text) to anon, authenticated;

notify pgrst, 'reload schema';
