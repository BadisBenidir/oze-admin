-- ============================================================================
-- Fix : les collaborateurs invités (actifs ou en attente) n'apparaissaient
-- pas dans "Mon équipe".
--
-- Cause : useResellerTeam.fetchTeam() lit reseller_contacts avec un JOIN
-- profiles!inner(...). La liaison reseller_contacts.reseller_id est posée
-- correctement dès l'invitation (voir invite-reseller-contact) — ce n'est
-- pas le problème. Mais `profiles` est une table partagée avec
-- oze-storefront dont la RLS (policies dashboard, non trackées dans les
-- migrations de ce dépôt) n'autorise visiblement qu'un utilisateur à lire
-- SA PROPRE ligne. Le contact principal ("Modo") pouvait donc se voir
-- lui-même dans la liste (son profil = auth.uid()), mais jamais un
-- collègue — actif ou non — puisqu'aucune policy n'autorisait cette
-- lecture croisée. Avec un INNER JOIN, une ligne profiles invisible fait
-- disparaître silencieusement toute la ligne reseller_contacts
-- correspondante, sans erreur.
--
-- Fix : nouvelle policy SELECT permissive (s'ajoute aux policies
-- existantes, n'en retire aucune) autorisant un contact revendeur à voir
-- le profil de tout autre contact de LA MÊME entreprise, via
-- current_reseller_id() (0011_resellers_full_rebuild).
-- ============================================================================

alter table public.profiles enable row level security;

drop policy if exists profiles_reseller_teammate_select on public.profiles;
create policy profiles_reseller_teammate_select on public.profiles
  for select
  using (
    exists (
      select 1 from public.reseller_contacts rc
      where rc.profile_id = profiles.id
        and rc.reseller_id = public.current_reseller_id()
    )
  );

notify pgrst, 'reload schema';
