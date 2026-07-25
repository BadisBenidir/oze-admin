-- ============================================================================
-- Module B2B Revendeurs — 38 : corrige le prix d'achat à 0 € sur "Chiffre
-- d'affaires B2B"
--
-- 0037 lisait product_snapshot->>'purchase_price' (figé au moment de la
-- vente) : sur la quasi-totalité des commandes existantes, ce champ valait
-- null à l'époque (prix d'achat renseigné sur la fiche produit APRÈS coup),
-- donc un total à 0 € malgré des prix d'achat bien réels aujourd'hui.
--
-- Bascule sur un JOIN direct vers products.purchase_price (valeur actuelle),
-- comme demandé : reflète immédiatement toute mise à jour de la fiche
-- produit, y compris pour des commandes déjà passées.
-- ============================================================================

create or replace view public.b2b_order_item_revenue as
select
  oi.id as order_item_id,
  oi.order_id,
  o.reseller_id,
  oi.status,
  oi.line_total,
  coalesce(p.purchase_price, 0) as purchase_price
from public.order_items oi
join public.orders o on o.id = oi.order_id
left join public.products p on p.id = oi.product_id
where o.order_channel = 'b2b'
  and public.is_admin();

grant select on public.b2b_order_item_revenue to authenticated;

notify pgrst, 'reload schema';
