-- ============================================================================
-- Comptabilité → Frais externes : catégories de dépenses gérées depuis l'admin
-- (frais d'envoi, commissions fournisseurs, douane…). expenses.category
-- contient le nom de la catégorie ; renommer une catégorie met à jour ses
-- dépenses (côté admin). Accès : propriétaire uniquement, comme expenses. Les frais de la période sont déduits de la marge
-- brute dans le Dashboard Global (« Résultat après frais »).
-- ============================================================================

create table if not exists public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  position int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.expense_categories enable row level security;
drop policy if exists expense_categories_admin_all on public.expense_categories;
create policy expense_categories_admin_all on public.expense_categories
  for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

insert into public.expense_categories (name, position)
select v.name, v.position
from (values
  ('Frais d''envoi', 10),
  ('Commissions fournisseurs', 20),
  ('Frais de douane', 30),
  ('Achat marchandise', 40),
  ('Emballages & fournitures', 50),
  ('Marketing & publicité', 60),
  ('Logiciels & abonnements', 70),
  ('Frais bancaires', 80),
  ('Loyer & locaux', 90),
  ('Autre', 100)
) as v (name, position)
where not exists (select 1 from public.expense_categories);

notify pgrst, 'reload schema';
