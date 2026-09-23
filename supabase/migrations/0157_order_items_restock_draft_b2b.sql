-- ============================================================================
-- L'annulation d'un lot d'enchère (admin_cancel_auction_item_core, 0156)
-- propose "Remettre en brouillon B2B" -> restock_action = 'draft-b2b', mais la
-- contrainte posée en 0032 sur order_items.restock_action n'autorisait que
-- 'draft' / 'for-sale-b2b' / 'archived' : l'annulation échouait avec
-- "violates check constraint order_items_restock_action_check".
-- 'draft-b2b' est un statut produit valide (0130/0135) : c'est celui qui
-- rend le produit à nouveau liable à un lot d'une prochaine session.
-- ============================================================================

alter table public.order_items drop constraint if exists order_items_restock_action_check;
alter table public.order_items add constraint order_items_restock_action_check
  check (restock_action is null or restock_action in ('draft', 'draft-b2b', 'for-sale-b2b', 'archived'));
