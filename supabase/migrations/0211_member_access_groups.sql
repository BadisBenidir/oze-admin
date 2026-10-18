-- ============================================================================
-- Groupe d'accès de chaque membre d'une communauté partenaire.
--
-- Le contact principal (ex. Aurel pour Aurel Vinted) classe chacun de ses
-- membres selon ce qu'il a payé pour entrer dans l'écosystème luxe :
--   1 = accès offert (0 €), 2 = 300 €, 3 = 700 €, 4 = nouveau membre.
-- Ce groupe fixera le prix de l'abonnement de chacun quand les abonnements
-- seront mis en place pour les communautés. null = pas encore classé.
-- Modifiable par le contact principal de l'entreprise (ses membres, jamais
-- lui-même) et par l'admin.
-- ============================================================================

alter table public.reseller_contacts add column if not exists member_group smallint
  check (member_group is null or member_group between 1 and 4);
alter table public.reseller_contacts add column if not exists member_group_updated_at timestamptz;

create or replace function public.set_member_group(p_contact_id uuid, p_group smallint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contact record;
begin
  if p_group is not null and (p_group < 1 or p_group > 4) then
    raise exception 'Groupe invalide';
  end if;

  select * into v_contact from public.reseller_contacts where id = p_contact_id;
  if not found then
    raise exception 'Membre introuvable';
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

revoke all on function public.set_member_group(uuid, smallint) from public, anon;
grant execute on function public.set_member_group(uuid, smallint) to authenticated;

notify pgrst, 'reload schema';
