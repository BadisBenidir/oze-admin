-- ============================================================================
-- Module B2B Revendeurs — 37 : prix d'achat et bénéfice sur "Chiffre
-- d'affaires B2B"
--
-- Granularité article (order_items), pas commande (orders.subtotal comme
-- l'ancienne b2b_reseller_revenue) : line_total est la valeur de vente de
-- CET article au moment de la commande, product_snapshot son prix d'achat
-- figé au même instant (to_jsonb(p.*) posé par confirm_b2b_payment /
-- pay_b2b_order_with_wallet / submit_b2b_order) — jamais le prix d'achat
-- ACTUEL du produit, qui a pu changer depuis. Exclut les articles annulés
-- (status='cancelled', voir 0032_b2b_order_item_cancellation.sql) : un
-- article remboursé n'est plus une vente réalisée.
-- ============================================================================

create or replace view public.b2b_order_item_revenue as
select
  oi.id as order_item_id,
  oi.order_id,
  o.reseller_id,
  oi.status,
  oi.line_total,
  coalesce((oi.product_snapshot ->> 'purchase_price')::numeric, 0) as purchase_price
from public.order_items oi
join public.orders o on o.id = oi.order_id
where o.order_channel = 'b2b'
  and public.is_admin();

grant select on public.b2b_order_item_revenue to authenticated;

notify pgrst, 'reload schema';
