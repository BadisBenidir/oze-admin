-- ============================================================================
-- Achat immédiat (suite de 0257) :
--
-- 1. Prix : à l'entrée en achat immédiat ('instant-b2b'), le prix B2B est
--    recalculé depuis le prix d'achat taxes comprises (purchase_price) :
--      achat × 1,40 arrondi au multiple de 5 inférieur, s'il dépasse 100 € ;
--      sinon achat × 1,35 (même arrondi).
--    Uniquement à l'entrée (un prix retouché ensuite à la main est gardé) et
--    seulement si le prix d'achat est connu. Les articles déjà en achat
--    immédiat sont recalculés une fois.
-- 2. Nouveau statut 'archived-instant-b2b' (« Archivé achat immédiat ») :
--    c'est là que va un article retiré de l'achat immédiat
--    (admin_set_instant_buy), et d'où il peut y revenir.
-- 3. Vendus : products.instant_sold_at, posé quand un article en achat
--    immédiat est vendu ; vue b2b_instant_sold pour les garder affichés
--    (grisés, « Vendu ») dans l'onglet de l'espace pro.
-- ============================================================================

alter table public.products drop constraint if exists products_status_check;
alter table public.products add constraint products_status_check check (status::text = any (array[
  'draft', 'draft-b2b', 'sourced-b2b', 'drop-b2b', 'auction-b2b', 'for-sale-online', 'for-sale-other-platform',
  'sold-online', 'sold-other-platform', 'sold-display', 'for-auction-live', 'sold-auction', 'for-sale-b2b',
  'instant-b2b', 'archived-instant-b2b', 'reserved-b2b', 'sold-b2b', 'archived', 'cadeau', 'cadeau-attribue', 'cadeau-livre'
]::text[]));

alter table public.products add column if not exists instant_sold_at timestamptz;

create or replace function public.instant_buy_price(p_purchase_price numeric)
returns numeric
language sql
immutable
as $$
  select case
    when coalesce(p_purchase_price, 0) <= 0 then null
    when floor(p_purchase_price * 1.40 / 5) * 5 > 100 then floor(p_purchase_price * 1.40 / 5) * 5
    else floor(p_purchase_price * 1.35 / 5) * 5
  end;
$$;

create or replace function public.products_instant_buy_only_for_sale()
returns trigger
language plpgsql
as $$
declare
  v_price numeric;
begin
  new.instant_buy := (new.status::text = 'instant-b2b');

  -- Entrée en achat immédiat : prix recalculé (marge 40 % / 35 %).
  if new.status::text = 'instant-b2b'
     and (tg_op = 'INSERT' or old.status::text is distinct from 'instant-b2b') then
    v_price := public.instant_buy_price(new.purchase_price);
    if v_price is not null and v_price > 0 then
      new.sale_price := v_price;
    end if;
  end if;

  -- Vendu depuis l'achat immédiat : reste affiché « Vendu » dans l'onglet.
  if tg_op = 'UPDATE' and old.status::text = 'instant-b2b' and new.status::text like 'sold-%' then
    new.instant_sold_at := now();
  end if;

  return new;
end;
$$;

-- Prix des articles déjà en achat immédiat (une fois).
update public.products
set sale_price = public.instant_buy_price(purchase_price)
where status::text = 'instant-b2b' and coalesce(public.instant_buy_price(purchase_price), 0) > 0;

create or replace function public.admin_set_instant_buy(
  p_product_ids uuid[],
  p_enabled boolean,
  p_target text default 'archived-instant-b2b'
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
    set status = 'instant-b2b',
        catalog_sort_at = v_now - (u.ord * interval '1 millisecond')
    from unnest(p_product_ids) with ordinality as u(pid, ord)
    where p.id = u.pid
      and p.status::text in ('draft', 'draft-b2b', 'for-sale-b2b', 'archived-instant-b2b')
      and (coalesce(p.purchase_price, 0) > 0 or coalesce(p.sale_price, 0) > 0);
  else
    if p_target not in ('archived-instant-b2b', 'for-sale-b2b', 'draft-b2b') then
      raise exception 'Destination invalide : %', p_target;
    end if;
    update public.products p
    set status = p_target
    where p.id = any(p_product_ids)
      and p.status::text = 'instant-b2b';
  end if;

  get diagnostics v_count = row_count;
  return jsonb_build_object('updated_count', v_count);
end;
$$;

-- Vendus de l'achat immédiat, pour les membres actifs (comme b2b_catalog),
-- masqués aussi quand la page est bloquée.
create or replace view public.b2b_instant_sold as
 SELECT p.id,
    p.name,
    p.product_code,
    p.brand_id,
    p.category_id,
    p.images,
    p.main_image_index,
    p.condition,
    p.sale_price AS price,
    p.original_price,
    p.instant_sold_at AS sold_at
   FROM products p
  WHERE p.instant_sold_at IS NOT NULL
    AND p.status::text LIKE 'sold-%'
    AND NOT public.instant_buy_locked()
    AND (EXISTS ( SELECT 1
           FROM reseller_contacts rc
             JOIN resellers rs ON rs.id = rc.reseller_id
          WHERE rc.profile_id = auth.uid() AND rs.status = 'active'::text));

revoke all on public.b2b_instant_sold from anon;
grant select on public.b2b_instant_sold to authenticated;

notify pgrst, 'reload schema';
