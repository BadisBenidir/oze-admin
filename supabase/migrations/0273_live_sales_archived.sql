-- ============================================================================
-- Ventes Live archivées (hors société) : les articles gardent leur statut
-- « Vendu (live) » mais sortent de la comptabilité, du CA du dashboard et de
-- la page Live (filtre sale_archived_at is null). Archivage des 27 ventes
-- Live existantes (juillet 2026).
-- ============================================================================

alter table public.products add column if not exists sale_archived_at timestamptz;

update public.products
set sale_archived_at = now()
where status = 'sold-auction' and sale_archived_at is null;
