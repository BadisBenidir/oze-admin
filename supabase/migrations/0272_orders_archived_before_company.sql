-- ============================================================================
-- Commandes archivées : ventes antérieures à la création de la société
-- (26 mai 2026). Elles restent en base (historique client, factures) mais
-- sortent de l'admin : dashboard, liste des commandes, comptabilité, journal
-- des ventes, export des factures (filtre archived_at is null).
-- ============================================================================

alter table public.orders add column if not exists archived_at timestamptz;

update public.orders
set archived_at = now()
where created_at < '2026-05-26' and archived_at is null;
