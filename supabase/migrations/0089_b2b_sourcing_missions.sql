-- Sourcing sur mesure / Mandats B2B.
--
-- Un revendeur verse une avance (ex. 5000 €) pour qu'on lui réalise un
-- sourcing sur mesure : ce montant impacte le CA B2B encaissé dès son
-- paiement, et sert d'enveloppe budgétaire dans laquelle les pièces
-- sourcées sont affectées au fur et à mesure (b2b_sourcing_items.billed_price).
--
-- Réservé aux admins OZË (public.is_admin(), défini en 0011) : les
-- revendeurs n'ont aujourd'hui aucune vue dédiée à ces mandats.

create table if not exists public.b2b_sourcing_missions (
  id uuid primary key default gen_random_uuid(),
  reseller_id uuid not null references public.resellers (id) on delete cascade,
  title text not null,
  budget_amount numeric(10, 2) not null check (budget_amount >= 0),
  status text not null default 'active' check (status in ('active', 'completed', 'cancelled')),
  payment_method text,
  paid_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists b2b_sourcing_missions_reseller_id_idx on public.b2b_sourcing_missions (reseller_id);
create index if not exists b2b_sourcing_missions_status_idx on public.b2b_sourcing_missions (status);

create table if not exists public.b2b_sourcing_items (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.b2b_sourcing_missions (id) on delete cascade,
  -- SET NULL (pas cascade) : si la fiche produit liée est supprimée plus
  -- tard, la ligne de sourcing (déjà facturée sur le budget) doit rester.
  product_id uuid references public.products (id) on delete set null,
  title text not null,
  brand text,
  billed_price numeric(10, 2) not null check (billed_price >= 0),
  cost_price numeric(10, 2) check (cost_price is null or cost_price >= 0),
  status text not null default 'sourced' check (status in ('sourced', 'validated', 'shipped', 'cancelled')),
  photos jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists b2b_sourcing_items_mission_id_idx on public.b2b_sourcing_items (mission_id);

alter table public.b2b_sourcing_missions enable row level security;

drop policy if exists b2b_sourcing_missions_admin_all on public.b2b_sourcing_missions;
create policy b2b_sourcing_missions_admin_all on public.b2b_sourcing_missions
  for all using (public.is_admin()) with check (public.is_admin());

alter table public.b2b_sourcing_items enable row level security;

drop policy if exists b2b_sourcing_items_admin_all on public.b2b_sourcing_items;
create policy b2b_sourcing_items_admin_all on public.b2b_sourcing_items
  for all using (public.is_admin()) with check (public.is_admin());

-- Détail des missions avec montant consommé (somme des pièces non annulées)
-- et reste à consommer — évite de recalculer l'agrégat côté client à chaque
-- affichage, même pattern que b2b_order_item_revenue pour le CA.
create or replace view public.b2b_sourcing_mission_totals as
select
  m.id as mission_id,
  coalesce(sum(i.billed_price) filter (where i.status != 'cancelled'), 0) as consumed_amount,
  m.budget_amount - coalesce(sum(i.billed_price) filter (where i.status != 'cancelled'), 0) as remaining_amount,
  count(i.id) filter (where i.status != 'cancelled') as items_count
from public.b2b_sourcing_missions m
left join public.b2b_sourcing_items i on i.mission_id = m.id
group by m.id, m.budget_amount;

grant select on public.b2b_sourcing_mission_totals to authenticated;

notify pgrst, 'reload schema';
