-- Onglet « Prêt à la livraison » : pouvoir marquer reçu à l'atelier un article
-- quel que soit son état :
--   - article pas encore vendu (brouillon, sourcing sur mesure, en vente…) :
--     products.received_at (0240) — à la vente, la ligne naîtra prête ;
--   - ligne dont la livraison est déjà demandée (ou plus loin) : on pose
--     seulement la date de réception, sans toucher à son statut.
create or replace function public.admin_mark_received_any(p_item_ids uuid[], p_product_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_items int := 0;
  v_products int := 0;
begin
  if not public.is_admin() then
    raise exception 'Accès refusé';
  end if;

  update public.order_items
  set received_at = coalesce(received_at, now())
  where id = any(coalesce(p_item_ids, '{}'))
    and status = 'active'
    and received_at is null;
  get diagnostics v_items = row_count;

  update public.products
  set received_at = coalesce(received_at, now())
  where received_at is null
    and (id = any(coalesce(p_product_ids, '{}'))
         or id in (select product_id from public.order_items where id = any(coalesce(p_item_ids, '{}')) and product_id is not null));
  get diagnostics v_products = row_count;

  return jsonb_build_object('updated_items', v_items, 'updated_products', v_products);
end;
$$;
revoke all on function public.admin_mark_received_any(uuid[], uuid[]) from public, anon;
grant execute on function public.admin_mark_received_any(uuid[], uuid[]) to authenticated;

notify pgrst, 'reload schema';
