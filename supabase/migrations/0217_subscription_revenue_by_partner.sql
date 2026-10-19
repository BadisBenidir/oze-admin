-- ============================================================================
-- CA des abonnements ventilé par partenaire (Comptabilité, Dashboard Global).
--
-- 1. club_promo_codes.partner_name : partenaire (influenceur) à qui revient un
--    code promo Club. Tout le CA d'un abonnement souscrit avec ce code (y
--    compris les renouvellements sans remise) lui est attribué ; sans
--    partenaire = « clients ».
-- 2. community_subscription_payments : chaque facture payée d'un abonnement
--    de membre de communauté (0214), enregistrée par b2b-stripe-webhook
--    (invoice.paid) — attribuée à l'entreprise partenaire (ex. Aurel Vinted).
-- ============================================================================

alter table public.club_promo_codes add column if not exists partner_name text;

update public.club_promo_codes set partner_name = 'Julia' where partner_name is null and code ilike 'JULIA%';
update public.club_promo_codes set partner_name = 'Dawsell' where partner_name is null and code ilike 'DAWSELL%';
update public.club_promo_codes set partner_name = 'Homade' where partner_name is null and code ilike 'HOMADE%';

create table if not exists public.community_subscription_payments (
  id uuid primary key default gen_random_uuid(),
  stripe_invoice_id text not null unique,
  stripe_subscription_id text,
  stripe_customer_id text,
  reseller_id uuid references public.resellers (id) on delete set null,
  contact_id uuid references public.reseller_contacts (id) on delete set null,
  profile_id uuid references public.profiles (id) on delete set null,
  amount numeric(10, 2) not null,
  currency text not null default 'eur',
  plan text,
  billing_reason text,
  invoice_number text,
  paid_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists community_subscription_payments_reseller_idx
  on public.community_subscription_payments (reseller_id, paid_at);

alter table public.community_subscription_payments enable row level security;

drop policy if exists community_subscription_payments_admin_select on public.community_subscription_payments;
create policy community_subscription_payments_admin_select on public.community_subscription_payments
  for select using (public.is_admin());

notify pgrst, 'reload schema';
