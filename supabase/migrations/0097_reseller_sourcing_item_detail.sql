-- Enrichit la vue revendeur reseller_sourcing_items avec les informations
-- descriptives de la fiche produit liée (quand product_id est renseigné —
-- voir 0089, nullable pour une pièce créée à la volée) : catégorie, état,
-- description, matière, couleurs, numéro de série, défauts. Sert la modale
-- de détail d'une pièce sourcée côté portail revendeur (façon fiche
-- catalogue), voir SourcingItemDetailModal.tsx.
--
-- ⚠️ Aucun prix n'est exposé ici, ni celui de la pièce (b2b_sourcing_items
-- .cost_price/.billed_price, déjà absents de cette vue depuis 0094) ni
-- celui de la fiche produit liée (products.purchase_price/.sale_price) —
-- volontairement exclus de la liste de colonnes ci-dessous.
create or replace view public.reseller_sourcing_items as
select
  i.id,
  i.mission_id,
  i.title,
  i.brand,
  i.photos,
  i.status,
  i.created_at,
  p.description,
  p.condition,
  p.material,
  p.colors,
  p.serial_number,
  p.defects,
  p.defect_images,
  c.name as category_name
from public.b2b_sourcing_items i
join public.b2b_sourcing_missions m on m.id = i.mission_id
left join public.products p on p.id = i.product_id
left join public.categories c on c.id = p.category_id
where m.is_published_to_reseller = true
  and i.status != 'cancelled'
  and (m.reseller_id = public.current_reseller_id() or m.user_id = auth.uid());

grant select on public.reseller_sourcing_items to authenticated;

notify pgrst, 'reload schema';
