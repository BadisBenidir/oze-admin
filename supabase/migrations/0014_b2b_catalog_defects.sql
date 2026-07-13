-- La vue b2b_catalog n'exposait pas les colonnes `defects` (texte libre) et
-- `defect_images` (photos dédiées aux imperfections) : nécessaires pour
-- afficher la section "transparence" dans la fiche produit détaillée du
-- catalogue revendeur.

drop view if exists public.b2b_catalog;
create view public.b2b_catalog as
select
  p.id, p.product_code, p.reference, p.name, p.brand_id, p.category_id, p.genre,
  p.weight, p.images, p.main_image_index, p.condition, p.description, p.colors,
  p.material, p.status, p.created_at, p.sale_price as price,
  p.defects, p.defect_images
from public.products p
where p.status = 'for-sale-b2b'
  and exists (
    select 1 from public.reseller_contacts rc
    join public.resellers rs on rs.id = rc.reseller_id
    where rc.profile_id = auth.uid() and rs.status = 'active'
  );

grant select on public.b2b_catalog to authenticated;

notify pgrst, 'reload schema';
