-- ============================================================================
-- Rollback demandé : réinitialise tout article actuellement en ready_to_ship
-- ou delivery_requested vers received (déjà réceptionné physiquement, on
-- annule juste la mise à disposition/demande), détache shipment_id/parcel_id,
-- et nettoie les shipments 'requested'/'partially_shipped' (aucun colis
-- réellement expédié) créés par erreur. Les shipments/shipment_parcels déjà
-- 'shipped' ne sont jamais touchés (travail Sendcloud réel).
-- Idempotent — sans effet si aucune ligne ne correspond.
-- ============================================================================

update public.order_items
set fulfillment_status = 'received', shipment_id = null, parcel_id = null, delivery_requested_at = null
where fulfillment_status in ('ready_to_ship', 'delivery_requested');

delete from public.shipment_parcels where shipment_id in (
  select id from public.shipments where status in ('requested', 'partially_shipped')
);
delete from public.shipments where status in ('requested', 'partially_shipped');
