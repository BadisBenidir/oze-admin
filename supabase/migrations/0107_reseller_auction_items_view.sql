-- ============================================================================
-- Vue revendeur pour les lots d'enchères — corrige deux problèmes du même
-- coup :
--
--   1. Description manquante : un lot lié à une fiche produit (product_id,
--      voir 0105) reste tant qu'il n'est pas vendu au statut 'draft' — or
--      products.description n'est jamais visible pour un revendeur sur un
--      produit 'draft' (RLS produits, voir b2b_catalog 0035 : uniquement
--      'for-sale-b2b' ou déjà commandé). Interroger `products` directement
--      depuis le portail revendeur renvoyait donc systématiquement product:
--      null tant que le lot n'était pas adjugé — la description ne
--      s'affichait jamais dans AuctionItemDetailModal.
--   2. Fuite de reserve_price : auction_items_reseller_select (0104)
--      autorise un SELECT sur TOUTE la ligne auction_items, RLS ne filtrant
--      que par ligne, jamais par colonne — un revendeur pouvait lire
--      reserve_price brut dans la réponse réseau alors que le cahier des
--      charges le voulait explicitement invisible.
--
-- Même stratégie que reseller_sourcing_items (0097) / b2b_catalog (0035) :
-- une vue dédiée qui n'expose que les colonnes autorisées, et qui contourne
-- la RLS de `products` via les privilèges du propriétaire de la vue (jamais
-- purchase_price, jamais reserve_price).
-- ============================================================================

create or replace view public.reseller_auction_items as
select
  ai.id,
  ai.session_id,
  ai.title,
  ai.brand,
  ai.grade,
  ai.images,
  ai.start_price,
  ai.current_price,
  ai.min_increment,
  ai.current_winner_id,
  ai.ends_at,
  ai.status,
  ai.created_at,
  p.description,
  p.material,
  p.colors,
  p.serial_number
from public.auction_items ai
left join public.products p on p.id = ai.product_id
where public.current_reseller_id() is not null;

grant select on public.reseller_auction_items to authenticated;

notify pgrst, 'reload schema';
