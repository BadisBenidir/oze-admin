-- ============================================================================
-- Ordre des articles d'un drop dans le catalogue revendeur.
-- Le catalogue triait par date de création de la fiche : l'ordre choisi dans
-- le drop (product_ids, mélangeable depuis l'admin) était ignoré.
--   - products.catalog_sort_at : clé de tri du catalogue (repli created_at) ;
--   - execute_due_drops : à la publication, les articles prennent l'ordre de
--     product_ids (le premier en haut du catalogue) ;
--   - b2b_catalog.sort_at : clé exposée au catalogue (colonne ajoutée en fin
--     de vue, définition identique sinon).
-- ============================================================================

alter table public.products add column if not exists catalog_sort_at timestamptz;

create or replace function public.execute_due_drops()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  due_drop record;
  v_now timestamptz := now();
begin
  for due_drop in
    select id, product_ids
    from public.drops
    where status = 'planifie' and scheduled_at <= now()
    order by scheduled_at
  loop
    update public.products p
    set status = 'for-sale-b2b',
        catalog_sort_at = v_now - (u.ord * interval '1 millisecond')
    from unnest(due_drop.product_ids) with ordinality as u(pid, ord)
    where p.id = u.pid and p.status in ('draft', 'draft-b2b', 'drop-b2b');

    update public.drops
    set status = 'publie', published_at = v_now
    where id = due_drop.id;
  end loop;
end;
$$;

create or replace view public.b2b_catalog as
 SELECT id,
    product_code,
    reference,
    b2b_reference,
    name,
    brand_id,
    category_id,
    genre,
    weight,
    images,
    main_image_index,
    condition,
    description,
    colors,
    material,
    status,
    created_at,
    sale_price AS price,
    defects,
    defect_images,
    (EXISTS ( SELECT 1
           FROM cart_items ci
          WHERE ci.product_id = p.id AND ci.user_id <> auth.uid() AND ci.expires_at IS NOT NULL AND ci.expires_at > now())) AS held_by_other,
    original_price,
    ( SELECT d.scheduled_at
           FROM drops d
          WHERE d.status = 'planifie'::text AND (p.id = ANY (d.product_ids))
          ORDER BY d.scheduled_at
         LIMIT 1) AS drop_preview_scheduled_at,
    COALESCE(catalog_sort_at, created_at) AS sort_at
   FROM products p
  WHERE status::text = 'for-sale-b2b'::text AND (EXISTS ( SELECT 1
           FROM reseller_contacts rc
             JOIN resellers rs ON rs.id = rc.reseller_id
          WHERE rc.profile_id = auth.uid() AND rs.status = 'active'::text)) OR status::text = 'draft'::text AND (EXISTS ( SELECT 1
           FROM drops d
          WHERE d.status = 'planifie'::text AND (p.id = ANY (d.product_ids)))) AND (EXISTS ( SELECT 1
           FROM reseller_contacts rc
             JOIN resellers rs ON rs.id = rc.reseller_id
          WHERE rc.profile_id = auth.uid() AND rs.status = 'active'::text AND rc.can_preview_drops = true));

notify pgrst, 'reload schema';
