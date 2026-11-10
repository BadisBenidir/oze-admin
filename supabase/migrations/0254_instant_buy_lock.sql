-- ============================================================================
-- Achat immédiat : blocage de la page par l'admin.
--
-- Page bloquée : l'onglet « Achat immédiat » de l'espace pro affiche un
-- cadenas et un message (par défaut « Aucun article disponible pour le
-- moment »), et les articles instant_buy disparaissent des vues revendeur
-- (b2b_catalog, b2b_reseller_product_detail) — pas seulement masqués à
-- l'écran. Les articles déjà achetés restent visibles par leur acheteur.
-- ============================================================================

create table if not exists public.b2b_feature_locks (
  feature text primary key,
  locked boolean not null default false,
  message text,
  updated_at timestamptz not null default now()
);

alter table public.b2b_feature_locks enable row level security;
-- Aucune policy : lecture / écriture uniquement via les fonctions ci-dessous.

insert into public.b2b_feature_locks (feature, locked) values ('instant_buy', false)
on conflict (feature) do nothing;

create or replace function public.instant_buy_locked()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select locked from public.b2b_feature_locks where feature = 'instant_buy'), false);
$$;

grant execute on function public.instant_buy_locked() to authenticated;

create or replace function public.get_instant_buy_lock()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('locked', coalesce(l.locked, false), 'message', l.message)
  from (select 1) x
  left join public.b2b_feature_locks l on l.feature = 'instant_buy';
$$;

revoke all on function public.get_instant_buy_lock() from public, anon;
grant execute on function public.get_instant_buy_lock() to authenticated;

create or replace function public.admin_set_instant_buy_lock(p_locked boolean, p_message text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Accès refusé';
  end if;

  insert into public.b2b_feature_locks (feature, locked, message, updated_at)
  values ('instant_buy', p_locked, nullif(trim(p_message), ''), now())
  on conflict (feature) do update
    set locked = excluded.locked, message = excluded.message, updated_at = now();

  return public.get_instant_buy_lock();
end;
$$;

revoke all on function public.admin_set_instant_buy_lock(boolean, text) from public, anon;
grant execute on function public.admin_set_instant_buy_lock(boolean, text) to authenticated;

-- Vues revendeur (0253) : mêmes définitions, articles instant_buy exclus
-- tant que la page est bloquée.
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
  WHERE NOT (instant_buy AND public.instant_buy_locked()) AND (status::text = 'for-sale-b2b'::text AND (EXISTS ( SELECT 1
           FROM reseller_contacts rc
             JOIN resellers rs ON rs.id = rc.reseller_id
          WHERE rc.profile_id = auth.uid() AND rs.status = 'active'::text)) OR status::text = 'draft'::text AND (EXISTS ( SELECT 1
           FROM drops d
          WHERE d.status = 'planifie'::text AND (p.id = ANY (d.product_ids)))) AND (EXISTS ( SELECT 1
           FROM reseller_contacts rc
             JOIN resellers rs ON rs.id = rc.reseller_id
          WHERE rc.profile_id = auth.uid() AND rs.status = 'active'::text AND rc.can_preview_drops = true)));

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
  WHERE NOT (instant_buy AND public.instant_buy_locked()) AND (status::text = 'for-sale-b2b'::text AND (EXISTS ( SELECT 1
           FROM reseller_contacts rc
             JOIN resellers rs ON rs.id = rc.reseller_id
          WHERE rc.profile_id = auth.uid() AND rs.status = 'active'::text)) OR status::text = 'draft'::text AND (EXISTS ( SELECT 1
           FROM drops d
          WHERE d.status = 'planifie'::text AND (p.id = ANY (d.product_ids)))) AND (EXISTS ( SELECT 1
           FROM reseller_contacts rc
             JOIN resellers rs ON rs.id = rc.reseller_id
          WHERE rc.profile_id = auth.uid() AND rs.status = 'active'::text AND rc.can_preview_drops = true))) OR (EXISTS ( SELECT 1
           FROM order_items oi
             JOIN orders o ON o.id = oi.order_id
          WHERE oi.product_id = p.id AND o.reseller_id = current_reseller_id()));

notify pgrst, 'reload schema';
