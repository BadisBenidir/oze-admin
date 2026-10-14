-- ============================================================================
-- Baisses de prix programmées (0200) : ancien prix barré dans le catalogue.
--
-- Le catalogue membres affiche déjà un prix barré + « -X % » quand
-- products.original_price > prix (0049, Catalog.tsx / ProductPage.tsx), mais
-- apply_due_b2b_price_changes ne touchait que sale_price : aucune baisse
-- n'apparaissait comme telle. Désormais, une BAISSE pose original_price =
-- l'ancien prix (sauf si un prix d'origine plus élevé est déjà affiché,
-- ex. deuxième baisse : on garde le tout premier prix). Une hausse au-dessus
-- du prix d'origine efface ce dernier (plus de remise à afficher).
-- Rattrapage des baisses déjà appliquées avant ce correctif.
-- ============================================================================

create or replace function public.apply_due_b2b_price_changes()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_applied int := 0;
  v_skipped int := 0;
  v_change record;
  v_product record;
begin
  for v_change in
    select * from public.b2b_price_changes
    where status = 'scheduled' and scheduled_at <= now()
    order by scheduled_at
    for update skip locked
  loop
    select id, status, sale_price, original_price into v_product from public.products where id = v_change.product_id for update;
    if not found or v_product.status <> 'for-sale-b2b' then
      update public.b2b_price_changes
      set status = 'skipped', old_price = v_product.sale_price, applied_at = now()
      where id = v_change.id;
      v_skipped := v_skipped + 1;
      continue;
    end if;

    update public.products
    set sale_price = v_change.new_price,
        original_price = case
          when v_change.new_price < v_product.sale_price
            then greatest(coalesce(v_product.original_price, 0), v_product.sale_price)
          when coalesce(v_product.original_price, 0) > v_change.new_price
            then v_product.original_price
          else null
        end,
        updated_at = now()
    where id = v_change.product_id;

    update public.b2b_price_changes
    set status = 'applied', old_price = v_product.sale_price, applied_at = now()
    where id = v_change.id;
    v_applied := v_applied + 1;
  end loop;

  return jsonb_build_object('applied', v_applied, 'skipped', v_skipped);
end;
$$;

revoke all on function public.apply_due_b2b_price_changes() from public, anon, authenticated;

-- Rattrapage : baisses déjà appliquées dont le prix est toujours en place.
update public.products p
set original_price = c.old_price
from public.b2b_price_changes c
where c.product_id = p.id
  and c.status = 'applied'
  and c.old_price > c.new_price
  and p.sale_price = c.new_price
  and p.status = 'for-sale-b2b'
  and coalesce(p.original_price, 0) < c.old_price;

notify pgrst, 'reload schema';
