-- ============================================================================
-- Édition à la volée du prix revendeur par pièce sourcée (0151 n'exposait
-- qu'un prix CALCULÉ, jamais modifiable). custom_reseller_price permet à
-- l'admin d'écraser ce calcul pièce par pièce (ex: négociation client) —
-- quand renseigné, c'est ce prix qui prévaut partout, sinon on retombe sur
-- floor(cost_price * (1 + marge%)) comme avant.
-- ============================================================================

alter table public.b2b_sourcing_items add column if not exists custom_reseller_price numeric(10, 2)
  check (custom_reseller_price is null or custom_reseller_price >= 0);

comment on column public.b2b_sourcing_items.custom_reseller_price is
  'Prix revendeur imposé manuellement par un admin pour cette pièce (voir 0152) — prévaut sur le calcul automatique floor(cost_price * (1 + marge%)) dès qu''il est renseigné.';

-- reseller_sourcing_items (0151) : unit_price privilégie désormais
-- custom_reseller_price sur le calcul automatique, toujours gouverné par
-- show_unit_prices (jamais exposé si la mission ne l'a pas activé).
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
    when not m.show_unit_prices then null
    when i.custom_reseller_price is not null then i.custom_reseller_price
    when i.cost_price is not null and m.advance_amount > 0
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
