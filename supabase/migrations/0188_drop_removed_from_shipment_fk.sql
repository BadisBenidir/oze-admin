-- ============================================================================
-- Correctif 0187 : la clé étrangère order_items.removed_from_shipment_id ->
-- shipments créait un 2e lien order_items <-> shipments ; PostgREST refusait
-- alors toutes les requêtes qui embarquent shipments depuis order_items
-- (« more than one relationship was found »), cassant Commandes B2B,
-- l'espace pro, etc. La colonne reste (simple uuid), sans clé étrangère.
-- ============================================================================

alter table public.order_items drop constraint if exists order_items_removed_from_shipment_id_fkey;

notify pgrst, 'reload schema';
