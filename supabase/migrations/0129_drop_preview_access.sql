-- ============================================================================
-- Mode avant-première pour drops planifiés (0031) : un sous-compte revendeur
-- désigné par l'admin peut consulter les articles d'un drop programmé
-- (photos, grade, description, prix) AVANT l'heure officielle d'ouverture,
-- mais ne peut jamais les acheter avant que execute_due_drops (0031) ne
-- bascule leur statut de 'draft' à 'for-sale-b2b'.
-- ============================================================================

alter table public.reseller_contacts add column if not exists can_preview_drops boolean not null default false;
comment on column public.reseller_contacts.can_preview_drops is
  'Accès en lecture seule aux articles d''un drop encore planifie (avant ouverture officielle) — jamais un droit d''achat, voir b2b_catalog/b2b_reseller_product_detail et le trigger cart_items_guard_purchasable.';

-- ----------------------------------------------------------------------------
-- b2b_catalog / b2b_reseller_product_detail : ajoute une seconde branche
-- d'accès pour les articles encore 'draft' mais déjà rattachés au
-- product_ids d'un drop 'planifie' (0031), réservée aux contacts avec
-- can_preview_drops = true. drop_preview_scheduled_at (nouvelle colonne
-- exposée) redevient NULL dès que le drop est exécuté (drops.status passe à
-- 'publie') ou pour tout article normalement en vente — le frontend s'en
-- sert comme signal unique pour désactiver l'achat et afficher le compte à
-- rebours ("Avant-première — Drop le ...").
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
  p.status = 'draft'
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
  p.status = 'draft'
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

-- ----------------------------------------------------------------------------
-- Garde-fou panier : bloque tout insert dans cart_items pour un produit qui
-- n'est pas (encore) 'for-sale-b2b' — même si l'appelant contourne
-- cart_add_item (fonction non versionnée ici, voir le commentaire dans
-- useB2BCart.ts sur "db push cassé") ou l'appelle directement via l'API
-- PostgREST. C'est la vraie barrière anti-achat en avant-première : le
-- filtrage de b2b_catalog/b2b_reseller_product_detail ci-dessus ne contrôle
-- que la VISIBILITE, jamais l'ACHAT.
-- ----------------------------------------------------------------------------
create or replace function public.guard_cart_item_purchasable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  select status into v_status from public.products where id = new.product_id;
  if v_status is distinct from 'for-sale-b2b' then
    raise exception 'Cet article n''est pas disponible à l''achat pour le moment (avant-première ou indisponible).';
  end if;
  return new;
end;
$$;

drop trigger if exists cart_items_guard_purchasable on public.cart_items;
create trigger cart_items_guard_purchasable
before insert on public.cart_items
for each row execute function public.guard_cart_item_purchasable();

notify pgrst, 'reload schema';
