-- ============================================================================
-- Nouveau statut `draft-b2b` : un article créé directement depuis "Produits
-- B2B" (espace Espace B2B > Produits B2B) part désormais en brouillon plutôt
-- que directement "en vente" — mais dans un statut dédié, distinct du
-- brouillon générique 'draft' (pipeline de scan B2C), pour que la liste
-- "Produits B2B" ne se mélange jamais avec les articles B2C encore en
-- attente de validation après scan. Même patron que 'sourced-b2b' (0122),
-- qui résolvait exactement le même problème pour les pièces liées à un
-- sourcing sur mesure.
--
-- Tout ce qui traitait jusqu'ici 'draft' comme "éligible à devenir B2B"
-- (vente B2B directe, sélection dans un drop, exécution d'un drop) doit
-- aussi accepter 'draft-b2b' — sinon un article créé via ce nouveau chemin
-- resterait bloqué en brouillon sans pouvoir suivre ces parcours existants.
-- ============================================================================

alter table public.products drop constraint if exists products_status_check;
alter table public.products
  add constraint products_status_check check (status in (
    'draft', 'draft-b2b', 'sourced-b2b', 'for-sale-online', 'for-sale-other-platform', 'sold-online',
    'sold-other-platform', 'sold-display', 'for-auction-live', 'sold-auction',
    'for-sale-b2b', 'reserved-b2b', 'sold-b2b', 'archived',
    'cadeau', 'cadeau-attribue', 'cadeau-livre'
  ));

-- ----------------------------------------------------------------------------
-- generate_b2b_reference (0016) : attribue aussi une référence B2B dès la
-- création en 'draft-b2b' (auparavant réservé à for-sale-b2b/reserved-b2b/
-- sold-b2b), pour que l'admin puisse déjà suivre/rechercher la pièce par sa
-- référence B2B avant même sa mise en vente. Ne remplace jamais une
-- référence déjà attribuée (inchangé).
-- ----------------------------------------------------------------------------
create or replace function public.generate_b2b_reference()
returns trigger
language plpgsql
as $$
declare
  v_year text := to_char(now(), 'YYYY');
  v_candidate text;
  v_attempts int := 0;
begin
  if new.status in ('draft-b2b', 'for-sale-b2b', 'reserved-b2b', 'sold-b2b') and new.b2b_reference is null then
    loop
      v_candidate := 'OZE-B2B-' || v_year || '-' || lpad(floor(random() * 10000)::int::text, 4, '0');
      exit when not exists (select 1 from public.products where b2b_reference = v_candidate);
      v_attempts := v_attempts + 1;
      if v_attempts > 50 then
        raise exception 'Impossible de générer une référence B2B unique après 50 tentatives';
      end if;
    end loop;
    new.b2b_reference := v_candidate;
  end if;
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- admin_record_direct_b2b_sale (0066) : la "vente B2B directe" doit aussi
-- fonctionner sur un article encore 'draft-b2b', pas seulement 'draft'.
-- ----------------------------------------------------------------------------
create or replace function public.admin_record_direct_b2b_sale(
  p_product_id uuid,
  p_reseller_id uuid,
  p_sale_price numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product record;
  v_reseller_email text;
  v_price numeric;
  v_order_id uuid;
  v_order_number text;
begin
  if not public.is_admin() then
    raise exception 'Accès refusé';
  end if;

  select * into v_product from public.products where id = p_product_id for update;
  if v_product is null then
    raise exception 'Produit introuvable';
  end if;
  if v_product.status not in ('draft', 'draft-b2b') then
    raise exception 'Seul un produit brouillon peut être basculé directement en vente B2B';
  end if;

  select contact_email into v_reseller_email from public.resellers where id = p_reseller_id;
  if v_reseller_email is null then
    raise exception 'Revendeur introuvable';
  end if;

  v_price := coalesce(p_sale_price, v_product.sale_price, 0);
  v_order_number := 'B2B-DIRECT-' || to_char(now(), 'YYYYMMDDHH24MISS') || '-' || substr(p_reseller_id::text, 1, 4);

  insert into public.orders (
    order_number, email, status, total_amount, subtotal, shipping_cost, currency,
    payment_status, reseller_id, placed_by_profile_id,
    order_channel, approval_status, approved_at
  ) values (
    v_order_number, v_reseller_email, 'confirmed', v_price, v_price, 0, 'EUR',
    'paid', p_reseller_id, null,
    'b2b', 'approved', now()
  )
  returning id into v_order_id;

  insert into public.order_items (order_id, product_id, quantity, unit_price, line_total, product_snapshot)
  values (v_order_id, p_product_id, 1, v_price, v_price, to_jsonb(v_product));

  update public.products
  set status = 'sold-b2b', reserved_by_reseller_id = p_reseller_id, reserved_by_order_id = v_order_id, reserved_at = now()
  where id = p_product_id;

  return jsonb_build_object('order_id', v_order_id, 'order_number', v_order_number);
end;
$$;

-- ----------------------------------------------------------------------------
-- execute_due_drops (0031) : bascule aussi les articles 'draft-b2b' d'un
-- drop échu vers 'for-sale-b2b', pas seulement ceux restés en 'draft'.
-- ----------------------------------------------------------------------------
create or replace function public.execute_due_drops()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  due_drop record;
begin
  for due_drop in
    select id, product_ids
    from public.drops
    where status = 'planifie' and scheduled_at <= now()
    order by scheduled_at
  loop
    update public.products
    set status = 'for-sale-b2b'
    where id = any(due_drop.product_ids) and status in ('draft', 'draft-b2b');

    update public.drops
    set status = 'publie', published_at = now()
    where id = due_drop.id;
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- b2b_catalog / b2b_reseller_product_detail (0129) : un article 'draft-b2b'
-- rattaché à un drop encore planifié doit être visible en avant-première au
-- même titre qu'un 'draft' classique.
-- ----------------------------------------------------------------------------
create or replace view public.b2b_catalog as
select
  p.id, p.product_code, p.reference, p.b2b_reference, p.name, p.brand_id, p.category_id, p.genre,
  p.weight, p.images, p.main_image_index, p.condition, p.description, p.colors,
  p.material, p.status, p.created_at, p.sale_price as price,
  p.defects, p.defect_images,
  exists (
    select 1 from public.cart_items ci
    where ci.product_id = p.id
      and ci.user_id <> auth.uid()
      and ci.expires_at is not null and ci.expires_at > now()
  ) as held_by_other,
  p.original_price,
  (
    select d.scheduled_at
    from public.drops d
    where d.status = 'planifie' and p.id = any(d.product_ids)
    order by d.scheduled_at asc
    limit 1
  ) as drop_preview_scheduled_at
from public.products p
where (
  p.status = 'for-sale-b2b'
  and exists (
    select 1 from public.reseller_contacts rc
    join public.resellers rs on rs.id = rc.reseller_id
    where rc.profile_id = auth.uid() and rs.status = 'active'
  )
)
or (
  p.status in ('draft', 'draft-b2b')
  and exists (
    select 1 from public.drops d
    where d.status = 'planifie' and p.id = any(d.product_ids)
  )
  and exists (
    select 1 from public.reseller_contacts rc
    join public.resellers rs on rs.id = rc.reseller_id
    where rc.profile_id = auth.uid() and rs.status = 'active' and rc.can_preview_drops = true
  )
);

grant select on public.b2b_catalog to authenticated;

create or replace view public.b2b_reseller_product_detail as
select
  p.id, p.product_code, p.reference, p.b2b_reference, p.name, p.brand_id, p.category_id, p.genre,
  p.weight, p.images, p.main_image_index, p.condition, p.description, p.colors,
  p.material, p.status, p.created_at, p.sale_price as price,
  p.defects, p.defect_images,
  exists (
    select 1 from public.cart_items ci
    where ci.product_id = p.id
      and ci.user_id <> auth.uid()
      and ci.expires_at is not null and ci.expires_at > now()
  ) as held_by_other,
  p.original_price,
  (
    select d.scheduled_at
    from public.drops d
    where d.status = 'planifie' and p.id = any(d.product_ids)
    order by d.scheduled_at asc
    limit 1
  ) as drop_preview_scheduled_at
from public.products p
where (
  p.status = 'for-sale-b2b'
  and exists (
    select 1 from public.reseller_contacts rc
    join public.resellers rs on rs.id = rc.reseller_id
    where rc.profile_id = auth.uid() and rs.status = 'active'
  )
)
or (
  p.status in ('draft', 'draft-b2b')
  and exists (
    select 1 from public.drops d
    where d.status = 'planifie' and p.id = any(d.product_ids)
  )
  and exists (
    select 1 from public.reseller_contacts rc
    join public.resellers rs on rs.id = rc.reseller_id
    where rc.profile_id = auth.uid() and rs.status = 'active' and rc.can_preview_drops = true
  )
)
or exists (
  select 1
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where oi.product_id = p.id
    and o.reseller_id = public.current_reseller_id()
);

grant select on public.b2b_reseller_product_detail to authenticated;

notify pgrst, 'reload schema';
