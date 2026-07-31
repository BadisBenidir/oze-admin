-- ============================================================================
-- La colonne orders.shipping_address est NOT NULL, mais le checkout B2B ne
-- collecte plus l'adresse de livraison (choisie plus tard, par lot, voir
-- request_batch_delivery / 0054_delivery_batches.sql). b2b-checkout envoie
-- désormais toujours un placeholder non-null (adresse entreprise connue +
-- note "À définir lors de la demande de livraison"), donc cette migration
-- n'est pas strictement nécessaire pour éviter l'erreur — mais on retire
-- quand même la contrainte en dur : une colonne qui peut légitimement rester
-- inconnue jusqu'à la demande de livraison ne doit pas imposer une valeur.
-- ============================================================================

alter table public.orders alter column shipping_address drop not null;
