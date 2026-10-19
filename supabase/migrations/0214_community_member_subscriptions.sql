-- ============================================================================
-- Abonnement payant des membres d'une communauté partenaire (0211/0212).
--
-- Depuis la fenêtre d'annonce du prix (CommunityPriceNotice), un membre peut
-- souscrire tout de suite son abonnement mensuel au prix de son groupe :
-- session Stripe Checkout ouverte par l'Edge Function community-subscription,
-- suivi par b2b-stripe-webhook (metadata.type = 'community_subscription').
-- Colonnes écrites uniquement par le service (aucune politique UPDATE pour
-- les membres sur reseller_contacts) ; lisibles par l'entreprise et l'admin.
--
-- « Ne plus afficher » : community_price_notice_dismissals, une ligne par
-- membre et par changement de prix annoncé.
-- ============================================================================

alter table public.reseller_contacts add column if not exists community_sub_status text;
alter table public.reseller_contacts add column if not exists community_sub_price numeric(10, 2);
alter table public.reseller_contacts add column if not exists community_sub_current_period_end timestamptz;
alter table public.reseller_contacts add column if not exists community_sub_started_at timestamptz;
alter table public.reseller_contacts add column if not exists community_sub_stripe_subscription_id text;
alter table public.reseller_contacts add column if not exists community_sub_stripe_customer_id text;

create index if not exists reseller_contacts_community_sub_idx
  on public.reseller_contacts (community_sub_stripe_subscription_id)
  where community_sub_stripe_subscription_id is not null;

create table if not exists public.community_price_notice_dismissals (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  price_id uuid not null references public.community_group_prices (id) on delete cascade,
  dismissed_at timestamptz not null default now(),
  primary key (profile_id, price_id)
);

alter table public.community_price_notice_dismissals enable row level security;

drop policy if exists community_price_notice_dismissals_own_select on public.community_price_notice_dismissals;
create policy community_price_notice_dismissals_own_select on public.community_price_notice_dismissals
  for select using (profile_id = auth.uid() or public.is_admin());

drop policy if exists community_price_notice_dismissals_own_insert on public.community_price_notice_dismissals;
create policy community_price_notice_dismissals_own_insert on public.community_price_notice_dismissals
  for insert with check (profile_id = auth.uid());

notify pgrst, 'reload schema';
