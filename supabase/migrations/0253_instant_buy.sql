-- ============================================================================
-- Achat immédiat : onglet dédié de l'espace pro, à côté du Catalogue.
--
-- Un article en achat immédiat reste un article 'for-sale-b2b' ordinaire
-- (panier, réservation, paiement carte / solde, commande : rien ne change),
-- simplement marqué products.instant_buy = true :
--   - le Catalogue n'affiche que instant_buy = false, l'onglet « Achat
--     immédiat » que instant_buy = true (colonne ajoutée aux deux vues) ;
--   - le marqueur tombe dès que l'article quitte 'for-sale-b2b' (vendu,
--     retiré, mis en drop / aux enchères...) : jamais d'article marqué
--     ailleurs que dans la vente ;
--   - admin_set_instant_buy : mise en achat immédiat depuis le stock
--     (draft / draft-b2b / for-sale-b2b), ou retrait (retour au catalogue ou
--     en brouillon B2B).
-- ============================================================================

alter table public.products add column if not exists instant_buy boolean not null default false;

create index if not exists products_instant_buy_idx on public.products (instant_buy) where instant_buy;

create or replace function public.products_instant_buy_only_for_sale()
returns trigger
language plpgsql
as $$
begin
  if new.instant_buy and new.status::text <> 'for-sale-b2b' then
    new.instant_buy := false;
  end if;
  return new;
end;
$$;

drop trigger if exists products_instant_buy_only_for_sale on public.products;
create trigger products_instant_buy_only_for_sale
  before insert or update of status, instant_buy on public.products
  for each row execute function public.products_instant_buy_only_for_sale();

-- Vues revendeur : définitions en production à l'identique (pg_get_viewdef),
-- plus la colonne instant_buy en dernier (create or replace view n'accepte
-- que l'ajout de colonnes en fin de liste).
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
    COALESCE(catalog_sort_at, created_at) AS sort_at,
    instant_buy
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

create or replace view public.b2b_reseller_product_detail as
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
    instant_buy
   FROM products p
  WHERE status::text = 'for-sale-b2b'::text AND (EXISTS ( SELECT 1
           FROM reseller_contacts rc
             JOIN resellers rs ON rs.id = rc.reseller_id
          WHERE rc.profile_id = auth.uid() AND rs.status = 'active'::text)) OR status::text = 'draft'::text AND (EXISTS ( SELECT 1
           FROM drops d
          WHERE d.status = 'planifie'::text AND (p.id = ANY (d.product_ids)))) AND (EXISTS ( SELECT 1
           FROM reseller_contacts rc
             JOIN resellers rs ON rs.id = rc.reseller_id
          WHERE rc.profile_id = auth.uid() AND rs.status = 'active'::text AND rc.can_preview_drops = true)) OR (EXISTS ( SELECT 1
           FROM order_items oi
             JOIN orders o ON o.id = oi.order_id
          WHERE oi.product_id = p.id AND o.reseller_id = current_reseller_id()));

-- p_enabled = true  : draft / draft-b2b / for-sale-b2b -> for-sale-b2b + achat
--                     immédiat, en tête de l'onglet (catalog_sort_at).
-- p_enabled = false : retrait ; p_target = 'for-sale-b2b' (reste en vente,
--                     dans le Catalogue) ou 'draft-b2b' (retiré de la vente).
create or replace function public.admin_set_instant_buy(
  p_product_ids uuid[],
  p_enabled boolean,
  p_target text default 'draft-b2b'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
  v_now timestamptz := now();
begin
  if not public.is_admin() then
    raise exception 'Accès refusé';
  end if;

  if p_enabled then
    update public.products p
    set status = 'for-sale-b2b',
        instant_buy = true,
        catalog_sort_at = v_now - (u.ord * interval '1 millisecond')
    from unnest(p_product_ids) with ordinality as u(pid, ord)
    where p.id = u.pid
      and p.status::text in ('draft', 'draft-b2b', 'for-sale-b2b')
      and coalesce(p.sale_price, 0) > 0;
  else
    if p_target not in ('for-sale-b2b', 'draft-b2b') then
      raise exception 'Destination invalide : %', p_target;
    end if;
    update public.products p
    set instant_buy = false,
        status = p_target
    where p.id = any(p_product_ids)
      and p.instant_buy
      and p.status::text = 'for-sale-b2b';
  end if;

  get diagnostics v_count = row_count;
  return jsonb_build_object('updated_count', v_count);
end;
$$;

revoke all on function public.admin_set_instant_buy(uuid[], boolean, text) from public, anon;
grant execute on function public.admin_set_instant_buy(uuid[], boolean, text) to authenticated;

notify pgrst, 'reload schema';
