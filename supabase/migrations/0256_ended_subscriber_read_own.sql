-- ============================================================================
-- Suite de 0255 : l'abonné dont l'abonnement est terminé doit pouvoir relire
-- sa propre fiche revendeur et sa propre fiche contact, sinon l'espace pro ne
-- peut pas le reconnaître (useResellerAuth) et le renvoie au réabonnement.
-- Les policies existantes passent par current_reseller_id() (comptes actifs
-- uniquement) : on ajoute la lecture de SES lignes, rien d'autre.
-- ============================================================================

drop policy if exists resellers_ended_subscriber_select_own on public.resellers;
create policy resellers_ended_subscriber_select_own on public.resellers
  for select to authenticated
  using (id = public.current_reseller_id_incl_ended());

drop policy if exists reseller_contacts_ended_subscriber_select_own on public.reseller_contacts;
create policy reseller_contacts_ended_subscriber_select_own on public.reseller_contacts
  for select to authenticated
  using (profile_id = auth.uid() and reseller_id = public.current_reseller_id_incl_ended());
