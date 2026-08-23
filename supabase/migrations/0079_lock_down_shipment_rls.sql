-- ============================================================================
-- Correctif de confidentialité : la policy reseller sur `shipments`/
-- `shipment_parcels` (0062) autorisait N'IMPORTE QUEL membre d'une entreprise
-- revendeur à voir TOUTES les expéditions de l'entreprise (adresse complète,
-- téléphone implicite via le colis, numéros de suivi Sendcloud), y compris
-- celles demandées par un autre sous-compte — plus permissif que la policy
-- déjà en place sur orders/order_items (0017), qui limite un contact non
-- principal à ses propres commandes. Aligne shipments/shipment_parcels sur la
-- même règle : chacun voit ses propres demandes de livraison (celles qu'IL a
-- demandées, requested_by_profile_id = auth.uid()) ; le contact principal de
-- l'entreprise (reseller_contacts.is_primary) voit en plus celles de toute
-- l'équipe, pour la gestion globale déjà permise ailleurs.
-- ============================================================================

drop policy if exists "Resellers can view their own shipments" on public.shipments;
create policy "Resellers can view their own shipments"
  on public.shipments for select
  using (
    requested_by_profile_id = auth.uid()
    or (
      reseller_id = public.current_reseller_id()
      and exists (
        select 1 from public.reseller_contacts rc
        where rc.profile_id = auth.uid()
          and rc.reseller_id = shipments.reseller_id
          and rc.is_primary
      )
    )
  );

drop policy if exists "Resellers can view their own shipment parcels" on public.shipment_parcels;
create policy "Resellers can view their own shipment parcels"
  on public.shipment_parcels for select
  using (
    exists (
      select 1 from public.shipments s
      where s.id = shipment_parcels.shipment_id
        and (
          s.requested_by_profile_id = auth.uid()
          or (
            s.reseller_id = public.current_reseller_id()
            and exists (
              select 1 from public.reseller_contacts rc
              where rc.profile_id = auth.uid()
                and rc.reseller_id = s.reseller_id
                and rc.is_primary
            )
          )
        )
    )
  );

notify pgrst, 'reload schema';
