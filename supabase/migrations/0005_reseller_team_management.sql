-- ============================================================================
-- Module B2B Revendeurs — 5/5 : auto-gestion d'équipe côté revendeur
--
-- Le contact "principal" (reseller_contacts.is_primary) d'une entreprise peut
-- désormais retirer les comptes de ses propres employés (non-principaux)
-- depuis son espace, sans passer par l'admin OZË. La création de comptes
-- passe déjà par l'Edge Function invite-reseller-contact (service-role), qui
-- vérifie elle-même que l'appelant est admin OU contact principal de la
-- bonne entreprise — donc aucune policy INSERT n'est nécessaire ici.
-- ============================================================================

drop policy if exists reseller_contacts_primary_delete on public.reseller_contacts;
create policy reseller_contacts_primary_delete on public.reseller_contacts
  for delete
  using (
    reseller_id = public.current_reseller_id()
    and is_primary = false
    and exists (
      select 1 from public.reseller_contacts self
      where self.profile_id = auth.uid()
        and self.is_primary = true
        and self.reseller_id = reseller_contacts.reseller_id
    )
  );
