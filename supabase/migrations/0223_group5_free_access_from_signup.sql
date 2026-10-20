-- ============================================================================
-- Groupe 5 « Offre 2 000 € » (0222) : les 6 mois d'accès offert partent de
-- l'INSCRIPTION du membre (reseller_contacts.created_at), pas de la date de
-- son classement dans le groupe 5. Un membre inscrit il y a plus de 6 mois et
-- classé ensuite dans le groupe 5 n'a donc plus d'accès offert.
-- Membres déjà dans le groupe 5 : date recalculée.
-- ============================================================================

create or replace function public.reseller_contacts_group5_access()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.member_group = 5 and (tg_op = 'INSERT' or old.member_group is distinct from 5) and not new.is_primary then
    new.free_access_until := coalesce(new.created_at, now()) + interval '6 months';
  end if;
  return new;
end;
$$;

update public.reseller_contacts
set free_access_until = created_at + interval '6 months'
where member_group = 5 and not is_primary;
