-- ============================================================================
-- Prix unitaire revendeur par pièce sourcée, optionnel par mission.
--
-- Formule : prix unitaire = floor(cost_price * (1 + marge% / 100)), où
-- marge% = (advance_amount - allocated_cost_budget) / advance_amount * 100
-- — exactement le calcul déjà affiché à l'admin dans SourcingMissionDetail
-- Modal.tsx ("Marge prévisionnelle ... (20%)"), jamais un nouveau champ de
-- marge saisi séparément. cost_price et allocated_cost_budget restent
-- STRICTEMENT internes (jamais exposés côté revendeur, voir 0120) : seule
-- la vue reseller_sourcing_items expose le résultat final du calcul, sous
-- contrôle du nouveau flag show_unit_prices (false par défaut : aucun
-- changement de comportement tant que l'admin ne l'active pas
-- explicitement mission par mission).
-- ============================================================================

alter table public.b2b_sourcing_missions add column if not exists show_unit_prices boolean not null default false;

comment on column public.b2b_sourcing_missions.show_unit_prices is
  'Si true, reseller_sourcing_items expose le prix unitaire calculé de chaque pièce au revendeur (jamais le prix d''achat ni la marge elle-même).';

-- reseller_sourcing_items (0120) : ajoute unit_price, calculé uniquement
-- quand show_unit_prices est activé sur la mission et que la pièce a un
-- cost_price renseigné — null sinon (aucune fuite de coût/marge possible,
-- seul le prix final calculé traverse la vue).
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
  c.name as category_name,
  case
    when m.show_unit_prices and i.cost_price is not null and m.advance_amount > 0
      then floor(i.cost_price * (1 + (m.advance_amount - m.allocated_cost_budget) / m.advance_amount))
    else null
  end as unit_price
from public.b2b_sourcing_items i
join public.b2b_sourcing_missions m on m.id = i.mission_id
left join public.products p on p.id = i.product_id
left join public.categories c on c.id = p.category_id
where m.is_published_to_reseller = true
  and i.status != 'cancelled'
  and m.user_id = auth.uid();

grant select on public.reseller_sourcing_items to authenticated;

notify pgrst, 'reload schema';
