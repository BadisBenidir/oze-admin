-- ============================================================================
-- Rattrapage ponctuel (0122 a ajouté le statut `sourced-b2b` et le trigger
-- qui le maintient désormais à jour, mais seulement pour les liaisons
-- FUTURES) : bascule maintenant tous les produits déjà liés à une pièce de
-- sourcing sur mesure non annulée, encore au statut 'draft', vers
-- 'sourced-b2b'. Ne touche jamais un produit déjà ailleurs (for-sale-*,
-- sold-*, etc.) ni une pièce annulée.
-- ============================================================================

update public.products p
set status = 'sourced-b2b'
where p.status = 'draft'
  and exists (
    select 1 from public.b2b_sourcing_items i
    where i.product_id = p.id and i.status <> 'cancelled'
  );
