-- ============================================================================
-- Badge « Disponible à la livraison » côté revendeur : article déjà reçu dans
-- nos locaux (products.received_at, 0240) — une fois acheté, la livraison
-- peut être demandée tout de suite (la ligne naît « prête », 0240).
-- Exposé dans b2b_catalog (catalogue B2B + achat immédiat) et
-- reseller_auction_items (enchères). Définitions reprises à l'identique de la
-- base, avec une colonne ajoutée en fin.
-- ============================================================================

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
          WHERE ((ci.product_id = p.id) AND (ci.user_id <> auth.uid()) AND (ci.expires_at IS NOT NULL) AND (ci.expires_at > now())))) AS held_by_other,
    original_price,
    ( SELECT d.scheduled_at
           FROM drops d
          WHERE ((d.status = 'planifie'::text) AND (p.id = ANY (d.product_ids)))
          ORDER BY d.scheduled_at
         LIMIT 1) AS drop_preview_scheduled_at,
    COALESCE(catalog_sort_at, created_at) AS sort_at,
    instant_buy,
    (received_at IS NOT NULL) AS available_for_delivery
   FROM products p
  WHERE ((NOT (instant_buy AND instant_buy_locked())) AND ((((status)::text = ANY (ARRAY['for-sale-b2b'::text, 'instant-b2b'::text])) AND (EXISTS ( SELECT 1
           FROM (reseller_contacts rc
             JOIN resellers rs ON ((rs.id = rc.reseller_id)))
          WHERE ((rc.profile_id = auth.uid()) AND (rs.status = 'active'::text))))) OR (((status)::text = 'draft'::text) AND (EXISTS ( SELECT 1
           FROM drops d
          WHERE ((d.status = 'planifie'::text) AND (p.id = ANY (d.product_ids))))) AND (EXISTS ( SELECT 1
           FROM (reseller_contacts rc
             JOIN resellers rs ON ((rs.id = rc.reseller_id)))
          WHERE ((rc.profile_id = auth.uid()) AND (rs.status = 'active'::text) AND (rc.can_preview_drops = true)))))));

create or replace view public.reseller_auction_items as
 SELECT ai.id,
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
    p.serial_number,
    ai."position",
    (p.received_at IS NOT NULL) AS available_for_delivery
   FROM (auction_items ai
     LEFT JOIN products p ON ((p.id = ai.product_id)))
  WHERE (current_reseller_id() IS NOT NULL);

notify pgrst, 'reload schema';
