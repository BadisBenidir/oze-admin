-- ============================================================================
-- Comptabilité → Autres revenus : revenus encaissés hors plateforme (virements,
-- PayPal, prestations), saisis à la main. Comptés dans le CA de la vue
-- d'ensemble (colonne « CA autres revenus »), la répartition par canal et le
-- Journal des ventes (Export Comptable Excel).
--
-- OZË Paris est en franchise de TVA : amount = montant encaissé.
-- purchase_price : coût d'achat d'un article vendu (marge), null pour une
-- prestation.
-- ============================================================================

create table if not exists public.manual_revenues (
  id uuid primary key default gen_random_uuid(),
  revenue_date date not null,
  client_name text not null,
  label text not null,
  amount numeric(10,2) not null check (amount > 0),
  category text not null check (category in ('vente', 'prestation', 'autre')),
  payment_method text check (payment_method in ('virement', 'paypal', 'especes', 'autre')),
  purchase_price numeric(10,2),
  qonto_transaction_id text,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists manual_revenues_revenue_date_idx on public.manual_revenues (revenue_date);

alter table public.manual_revenues enable row level security;
drop policy if exists manual_revenues_admin_all on public.manual_revenues;
create policy manual_revenues_admin_all on public.manual_revenues
  for all using (public.is_admin()) with check (public.is_admin());

-- Revenus déjà encaissés sur Qonto. Une ligne n'est pas insérée si une
-- commande ou un paiement d'abonnement du même montant existe déjà le même
-- jour (doublon), ni si elle a déjà été saisie (migration rejouable).
insert into public.manual_revenues (revenue_date, client_name, label, amount, category, payment_method)
select v.revenue_date, v.client_name, v.label, v.amount, v.category, v.payment_method
from (values
  ('2026-07-22'::date, 'PayPal (client à préciser)', 'Vente via PayPal', 350.00, 'vente', 'paypal'),
  ('2026-07-31'::date, 'Billel Arbouche', 'Vente (virement Revolut)', 392.40, 'vente', 'virement'),
  ('2026-08-12'::date, 'PayPal (client à préciser)', 'Vente via PayPal', 246.72, 'vente', 'paypal'),
  ('2026-08-28'::date, 'Fatah Benidir', 'Achat maroquinerie', 1479.68, 'vente', 'virement'),
  ('2026-09-01'::date, 'Isabelle Anna Zarec', 'Vente (virement N26)', 2060.47, 'vente', 'virement'),
  ('2026-09-01'::date, 'Billel Arbouche', 'Vente (virement Revolut)', 218.75, 'vente', 'virement'),
  ('2026-10-31'::date, 'Aurel Hey', 'Accompagnement Groupe 3 – Octobre 2026', 1330.00, 'prestation', 'virement'),
  ('2026-10-31'::date, 'Aurel Hey', 'Pack Luxe 6 mois – Octobre 2026', 300.00, 'prestation', 'virement')
) as v (revenue_date, client_name, label, amount, category, payment_method)
where not exists (
    select 1 from public.manual_revenues m
    where m.revenue_date = v.revenue_date and m.amount = v.amount and m.label = v.label
  )
  and not exists (
    select 1 from public.orders o
    where o.created_at::date = v.revenue_date and o.total_amount = v.amount
  )
  and not exists (
    select 1 from public.b2b_subscription_payments p
    where p.paid_at::date = v.revenue_date and p.amount = v.amount
  )
  and not exists (
    select 1 from public.community_subscription_payments p
    where p.paid_at::date = v.revenue_date and p.amount = v.amount
  );

notify pgrst, 'reload schema';
