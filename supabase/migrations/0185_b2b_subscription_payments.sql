-- ============================================================================
-- Paiements des abonnements Club B2B (Pass Drops / Pass Revendeur).
--
-- Jusqu'ici, ces paiements n'existaient que chez Stripe : ils n'entraient ni
-- dans le CA du Dashboard ni en Comptabilité. Une ligne par facture
-- d'abonnement payée (souscription, renouvellement mensuel, différence au
-- prorata d'un changement de pass) :
--   - enregistrée par le webhook (invoice.paid) ;
--   - rattrapage des paiements passés : Edge Function sync-subscription-payments.
-- Aucun coût d'achat : un abonnement est 100 % de marge.
-- ============================================================================

create table if not exists public.b2b_subscription_payments (
  id uuid primary key default gen_random_uuid(),
  stripe_invoice_id text not null unique,
  stripe_customer_id text,
  stripe_subscription_id text,
  reseller_id uuid references public.resellers (id) on delete set null,
  amount numeric(10, 2) not null,
  currency text not null default 'eur',
  plan text,
  billing_reason text,
  invoice_number text,
  paid_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists b2b_subscription_payments_paid_at_idx on public.b2b_subscription_payments (paid_at);

alter table public.b2b_subscription_payments enable row level security;

drop policy if exists b2b_subscription_payments_admin_select on public.b2b_subscription_payments;
create policy b2b_subscription_payments_admin_select on public.b2b_subscription_payments
  for select using (public.is_admin());

notify pgrst, 'reload schema';
