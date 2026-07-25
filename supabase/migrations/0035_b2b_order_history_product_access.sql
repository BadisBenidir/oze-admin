-- ============================================================================
-- Module B2B Revendeurs — 35 : accès à la fiche produit depuis l'historique
-- de commandes, même si l'article n'est plus au catalogue (vendu/archivé)
--
-- b2b_catalog ne montrait que les articles status='for-sale-b2b' : un
-- revendeur ne pouvait plus revoir la fiche complète (photos, défauts,
-- description, référence) d'un article déjà acheté une fois vendu. On
-- élargit le WHERE pour couvrir aussi "cet article appartient à une
-- commande de MA société" (peu importe son statut actuel) — jamais un accès
-- large à tous les produits vendus/archivés du site, seulement ceux
-- réellement commandés par le revendeur connecté.
--
-- Au passage : `b2b_reference` (référence SKU "OZE-B2B-[ANNÉE]-[NNNN]", censée
-- avoir été ajoutée par 0016_b2b_reference.sql) n'existe en fait pas sur la
-- base réelle — cette migration ne semble jamais avoir été appliquée en
-- production malgré sa présence dans l'historique du dépôt. On la (re)crée
-- ici, idempotente, pour de vrai cette fois, puisque la fiche produit
-- l'affiche déjà (ProductPage.tsx) et que la demande actuelle en dépend.
-- ============================================================================

alter table public.products add column if not exists b2b_reference text unique;

create or replace function public.generate_b2b_reference()
returns trigger
language plpgsql
as $$
declare
  v_year text := to_char(now(), 'YYYY');
  v_candidate text;
  v_attempts int := 0;
begin
  if new.status in ('for-sale-b2b', 'reserved-b2b', 'sold-b2b') and new.b2b_reference is null then
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

drop trigger if exists trg_generate_b2b_reference on public.products;
create trigger trg_generate_b2b_reference
before insert or update on public.products
for each row
execute function public.generate_b2b_reference();

-- Backfill des produits B2B déjà existants sans référence.
update public.products set status = status
where status in ('for-sale-b2b', 'reserved-b2b', 'sold-b2b') and b2b_reference is null;

----------------------------------------------------------------------------
-- b2b_catalog : élargit l'accès + expose b2b_reference.
----------------------------------------------------------------------------
drop view if exists public.b2b_catalog;
create view public.b2b_catalog as
select
  p.id, p.product_code, p.reference, p.b2b_reference, p.name, p.brand_id, p.category_id, p.genre,
  p.weight, p.images, p.main_image_index, p.condition, p.description, p.colors,
  p.material, p.status, p.created_at, p.sale_price as price,
  p.defects, p.defect_images,
  exists (
    select 1 from public.b2b_cart_holds h
    where h.product_id = p.id
      and h.profile_id <> auth.uid()
      and h.expires_at > now()
  ) as held_by_other
from public.products p
where (
  p.status = 'for-sale-b2b'
  and exists (
    select 1 from public.reseller_contacts rc
    join public.resellers rs on rs.id = rc.reseller_id
    where rc.profile_id = auth.uid() and rs.status = 'active'
  )
)
or exists (
  select 1
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where oi.product_id = p.id
    and o.reseller_id = public.current_reseller_id()
);

grant select on public.b2b_catalog to authenticated;

notify pgrst, 'reload schema';
