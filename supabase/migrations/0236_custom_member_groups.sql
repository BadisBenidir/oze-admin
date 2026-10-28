-- ============================================================================
-- Groupes d'accès personnalisés d'une communauté partenaire.
-- En plus des groupes 1 à 5 (0211, 0222), l'admin crée des groupes propres à
-- une communauté (numéros 6 et suivants) : nom, description, couleur. Il y
-- classe les membres de son choix et leur programme un prix comme pour les
-- autres groupes (community_group_prices).
--   - community_custom_groups : définition des groupes ;
--   - groupes 1..99 acceptés dans reseller_contacts / community_group_prices ;
--   - set_member_group : groupes 1..5 ou groupe personnalisé de la communauté ;
--   - admin_delete_custom_group : suppression (membres déclassés, prix retirés).
-- ============================================================================

create table if not exists public.community_custom_groups (
  id uuid primary key default gen_random_uuid(),
  reseller_id uuid not null references public.resellers (id) on delete cascade,
  member_group smallint not null check (member_group between 6 and 99),
  label text not null check (length(trim(label)) > 0),
  hint text,
  color text not null default 'slate',
  created_at timestamptz not null default now(),
  unique (reseller_id, member_group)
);

alter table public.community_custom_groups enable row level security;

drop policy if exists community_custom_groups_admin_all on public.community_custom_groups;
create policy community_custom_groups_admin_all on public.community_custom_groups
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists community_custom_groups_member_select on public.community_custom_groups;
create policy community_custom_groups_member_select on public.community_custom_groups
  for select using (reseller_id = public.current_reseller_id());

alter table public.reseller_contacts drop constraint if exists reseller_contacts_member_group_check;
alter table public.reseller_contacts add constraint reseller_contacts_member_group_check
  check (member_group is null or member_group between 1 and 99);

alter table public.community_group_prices drop constraint if exists community_group_prices_member_group_check;
alter table public.community_group_prices add constraint community_group_prices_member_group_check
  check (member_group between 1 and 99);

create or replace function public.set_member_group(p_contact_id uuid, p_group smallint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contact record;
begin
  select * into v_contact from public.reseller_contacts where id = p_contact_id;
  if not found then
    raise exception 'Membre introuvable';
  end if;

  if p_group is not null and not (p_group between 1 and 5 or exists (
    select 1 from public.community_custom_groups g where g.reseller_id = v_contact.reseller_id and g.member_group = p_group
  )) then
    raise exception 'Groupe invalide';
  end if;

  if not public.is_admin() and not exists (
    select 1 from public.reseller_contacts me
    where me.profile_id = auth.uid() and me.reseller_id = v_contact.reseller_id and me.is_primary
  ) then
    raise exception 'Seul le contact principal de l''entreprise peut classer ses membres';
  end if;
  if v_contact.is_primary and not public.is_admin() then
    raise exception 'Le contact principal ne se classe pas lui-même';
  end if;

  update public.reseller_contacts
  set member_group = p_group, member_group_updated_at = now()
  where id = p_contact_id;

  return jsonb_build_object('contact_id', p_contact_id, 'member_group', p_group);
end;
$$;

create or replace function public.admin_delete_custom_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group record;
begin
  if not public.is_admin() then
    raise exception 'Accès refusé : réservé aux administrateurs';
  end if;
  select * into v_group from public.community_custom_groups where id = p_group_id;
  if not found then
    raise exception 'Groupe introuvable';
  end if;

  update public.reseller_contacts
  set member_group = null, member_group_updated_at = now()
  where reseller_id = v_group.reseller_id and member_group = v_group.member_group;
  delete from public.community_group_prices
  where reseller_id = v_group.reseller_id and member_group = v_group.member_group;
  delete from public.community_custom_groups where id = p_group_id;
end;
$$;

grant execute on function public.admin_delete_custom_group(uuid) to authenticated;

notify pgrst, 'reload schema';
