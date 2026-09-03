-- b2b_sourcing_mission_totals (0091) ne comptait dans consumed_cost_amount
-- que les pièces 'validated'/'shipped' — une pièce tout juste ajoutée reste
-- 'sourced' par défaut (voir 0089), donc la jauge/le bandeau d'une mission
-- affichait 0,00 € consommé juste après un ajout, même avec 10 pièces déjà
-- cochées et un cost_price renseigné. On compte désormais TOUTE pièce non
-- annulée, dès son ajout — même filtre que items_count, qui faisait déjà
-- ça correctement.
create or replace view public.b2b_sourcing_mission_totals as
select
  m.id as mission_id,
  coalesce(sum(i.cost_price) filter (where i.status != 'cancelled'), 0) as consumed_cost_amount,
  m.allocated_cost_budget - coalesce(sum(i.cost_price) filter (where i.status != 'cancelled'), 0) as remaining_cost_budget,
  count(i.id) filter (where i.status != 'cancelled') as items_count
from public.b2b_sourcing_missions m
left join public.b2b_sourcing_items i on i.mission_id = m.id
group by m.id, m.allocated_cost_budget;

grant select on public.b2b_sourcing_mission_totals to authenticated;

notify pgrst, 'reload schema';
