-- ============================================================================
-- Corrige la synchronisation temps réel des enchères B2B : useAuctionItems.ts
-- (ligne ~142) s'abonne déjà à postgres_changes sur auction_items (UPDATE) et
-- auction_bids (INSERT) depuis la mise en place du système (0104), mais
-- aucune de ces deux tables n'a jamais été ajoutée à la publication
-- supabase_realtime — Postgres ne diffusait donc jamais ces événements, et
-- les autres revendeurs ne voyaient un nouveau prix qu'en rechargeant la
-- page (F5). Même mécanisme que product_reservation_signals (0084).
--
-- REPLICA IDENTITY FULL sur auction_items seulement : c'est la seule des
-- deux tables écoutée en UPDATE (auction_bids n'est écoutée qu'en INSERT,
-- qui envoie toujours la ligne complète quelle que soit la replica identity).
-- Le callback du hook ignore de toute façon le payload et refait un simple
-- fetchAll(), mais FULL évite un futur piège si le payload est exploité
-- directement plus tard (ex: flash visuel sur le nouveau prix sans refetch).
-- ============================================================================

alter table public.auction_items replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'auction_items'
  ) then
    alter publication supabase_realtime add table public.auction_items;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'auction_bids'
  ) then
    alter publication supabase_realtime add table public.auction_bids;
  end if;
end $$;
