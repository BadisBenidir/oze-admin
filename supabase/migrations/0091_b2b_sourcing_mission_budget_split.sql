-- Sépare l'avance encaissée (CA) de l'enveloppe allouée aux achats sur le
-- terrain. Avant cette migration, un seul montant (budget_amount) servait à
-- la fois de CA encaissé ET de plafond consommé par billed_price des
-- pièces sourcées — impossible d'en tirer une vraie marge, et la
-- consommation se basait sur le prix de VENTE prévu, pas sur le prix
-- d'ACHAT réellement dépensé sur le terrain.
--
-- Désormais :
--   advance_amount        = ce que le client a payé (alimente le CA B2B
--                            encaissé, voir useB2BRevenue.ts — logique déjà
--                            en place, seul le nom de colonne change).
--   allocated_cost_budget = enveloppe qu'on s'autorise à dépenser en achat.
--   marge brute théorique = advance_amount - allocated_cost_budget.
alter table public.b2b_sourcing_missions rename column budget_amount to advance_amount;

alter table public.b2b_sourcing_missions
  add column if not exists allocated_cost_budget numeric(10, 2) not null default 0 check (allocated_cost_budget >= 0);

comment on column public.b2b_sourcing_missions.advance_amount is
  'Avance versée par le client — alimente le CA B2B encaissé dès paiement (paid_at renseigné, statut != cancelled). Jamais confondue avec allocated_cost_budget.';
comment on column public.b2b_sourcing_missions.allocated_cost_budget is
  'Enveloppe allouée aux achats sur le terrain pour cette mission — consommée par b2b_sourcing_items.cost_price (jamais billed_price), voir b2b_sourcing_mission_totals.';

-- La consommation de l'enveloppe d'achat se fait sur cost_price (prix
-- d'achat réel payé sur le terrain), jamais billed_price (prix de vente
-- prévu au client) — et uniquement pour les pièces VALIDÉES ou déjà
-- expédiées : une pièce simplement "sourcée" (repérée, pas encore achetée)
-- n'engage pas encore de dépense réelle.
drop view if exists public.b2b_sourcing_mission_totals;

create view public.b2b_sourcing_mission_totals as
select
  m.id as mission_id,
  coalesce(sum(i.cost_price) filter (where i.status in ('validated', 'shipped')), 0) as consumed_cost_amount,
  m.allocated_cost_budget - coalesce(sum(i.cost_price) filter (where i.status in ('validated', 'shipped')), 0) as remaining_cost_budget,
  count(i.id) filter (where i.status != 'cancelled') as items_count
from public.b2b_sourcing_missions m
left join public.b2b_sourcing_items i on i.mission_id = m.id
group by m.id, m.allocated_cost_budget;

grant select on public.b2b_sourcing_mission_totals to authenticated;

notify pgrst, 'reload schema';
