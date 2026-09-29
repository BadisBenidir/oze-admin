-- ============================================================================
-- Abonnements Club B2B souscrits depuis la landing publique pro.ozeparis.com.
--
-- Parcours :
--   landing → /inscription?pass=drops|revendeur (visiteur non connecté :
--   identité + adresse de FACTURATION, jamais d'infos entreprise — le statut
--   juridique se déclare ensuite dans "Mon profil", comme tout sous-compte)
--   → insertion dans b2b_signup_requests
--   → Stripe Payment Link (client_reference_id = id de la demande)
--   → webhook b2b-stripe-webhook (checkout.session.completed, mode
--     subscription) : crée automatiquement un revendeur "abonné"
--     (account_type = 'subscriber', status = 'active'), son unique compte
--     de connexion (is_primary = false : même tableau de bord qu'un
--     sous-compte, sans gestion d'équipe) et envoie l'invitation par email.
--   Les événements customer.subscription.updated/deleted tiennent ensuite
--   à jour le pass, l'échéance, la résiliation programmée — et coupent
--   l'accès (status = 'suspended') quand l'abonnement se termine.
--
-- Pass Drops : enchères et sourcing sur mesure non inclus. L'interface les
-- affiche verrouillés (avec passage au Pass Revendeur), et la base refuse
-- de toute façon une enchère ou la validation d'une mission (triggers
-- ci-dessous), même appelées directement.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Demandes d'inscription
-- ----------------------------------------------------------------------------
create table if not exists public.b2b_signup_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  plan text not null check (plan in ('drops', 'revendeur')),
  first_name text not null check (length(trim(first_name)) between 1 and 100),
  last_name text not null check (length(trim(last_name)) between 1 and 100),
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(email) <= 254),
  phone text not null check (length(trim(phone)) between 6 and 30),
  -- Adresse de FACTURATION (l'adresse de livraison se choisit à chaque demande d'expédition)
  billing_address text not null check (length(trim(billing_address)) between 1 and 300),
  billing_postal_code text not null check (length(trim(billing_postal_code)) between 1 and 20),
  billing_city text not null check (length(trim(billing_city)) between 1 and 100),
  billing_country text not null check (length(trim(billing_country)) between 1 and 60),
  terms_accepted_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'account_created', 'needs_review', 'cancelled')),
  stripe_session_id text,
  stripe_customer_id text,
  stripe_subscription_id text,
  reseller_id uuid references public.resellers(id) on delete set null,
  admin_notes text
);

create index if not exists b2b_signup_requests_created_at_idx
  on public.b2b_signup_requests (created_at desc);
create index if not exists b2b_signup_requests_status_idx
  on public.b2b_signup_requests (status);

alter table public.b2b_signup_requests enable row level security;

-- Visiteur (anon) ou connecté : insertion d'une nouvelle demande uniquement,
-- sans pouvoir forcer un statut, un rattachement ou des identifiants Stripe.
-- L'id est généré côté client : pas besoin de relire la ligne (aucun SELECT).
drop policy if exists "b2b_signup_requests_public_insert" on public.b2b_signup_requests;
create policy "b2b_signup_requests_public_insert"
  on public.b2b_signup_requests
  for insert
  to anon, authenticated
  with check (
    status = 'pending'
    and reseller_id is null
    and admin_notes is null
    and stripe_session_id is null
    and stripe_customer_id is null
    and stripe_subscription_id is null
    and terms_accepted_at <= now() + interval '5 minutes'
  );

drop policy if exists "b2b_signup_requests_admin_select" on public.b2b_signup_requests;
create policy "b2b_signup_requests_admin_select"
  on public.b2b_signup_requests
  for select
  to authenticated
  using (public.is_admin());

drop policy if exists "b2b_signup_requests_admin_update" on public.b2b_signup_requests;
create policy "b2b_signup_requests_admin_update"
  on public.b2b_signup_requests
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant insert on public.b2b_signup_requests to anon, authenticated;
grant select, update on public.b2b_signup_requests to authenticated;

-- ----------------------------------------------------------------------------
-- Revendeurs : entreprise (création par l'admin, inchangée) ou abonné
-- (création automatique après paiement). Les colonnes d'abonnement ne sont
-- écrites que par le service role (webhook / b2b-subscription).
-- ----------------------------------------------------------------------------
alter table public.resellers
  add column if not exists account_type text not null default 'company';
alter table public.resellers drop constraint if exists resellers_account_type_check;
alter table public.resellers
  add constraint resellers_account_type_check check (account_type in ('company', 'subscriber'));

alter table public.resellers add column if not exists subscription_plan text;
alter table public.resellers drop constraint if exists resellers_subscription_plan_check;
alter table public.resellers
  add constraint resellers_subscription_plan_check check (subscription_plan is null or subscription_plan in ('drops', 'revendeur'));

alter table public.resellers add column if not exists stripe_customer_id text;
alter table public.resellers add column if not exists stripe_subscription_id text;
alter table public.resellers add column if not exists subscription_status text;
alter table public.resellers add column if not exists subscription_current_period_end timestamptz;
alter table public.resellers add column if not exists subscription_cancel_at_period_end boolean not null default false;

create unique index if not exists resellers_stripe_subscription_id_key
  on public.resellers (stripe_subscription_id) where stripe_subscription_id is not null;

-- ----------------------------------------------------------------------------
-- Droits par pass : seul un abonné au Pass Drops est restreint. Les
-- entreprises (account_type = 'company') gardent tout, comme aujourd'hui.
-- ----------------------------------------------------------------------------
create or replace function public.reseller_plan_allows(p_user_id uuid, p_feature text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select not exists (
    select 1
    from public.reseller_contacts rc
    join public.resellers rs on rs.id = rc.reseller_id
    where rc.profile_id = p_user_id
      and rs.account_type = 'subscriber'
      and rs.subscription_plan = 'drops'
      and p_feature in ('auctions', 'sourcing')
  );
$$;

revoke all on function public.reseller_plan_allows(uuid, text) from public, anon;
grant execute on function public.reseller_plan_allows(uuid, text) to authenticated, service_role;

create or replace function public.auction_bids_require_plan()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.reseller_plan_allows(new.user_id, 'auctions') then
    raise exception 'Les enchères ne sont pas incluses dans votre Pass Drops. Passez au Pass Revendeur pour enchérir.';
  end if;
  return new;
end;
$$;

drop trigger if exists auction_bids_require_plan on public.auction_bids;
create trigger auction_bids_require_plan
  before insert on public.auction_bids
  for each row execute function public.auction_bids_require_plan();

-- Validation d'une mission par le revendeur (reseller_validate_sourcing_mission
-- passe la mission en 'completed' avec auth.uid() = le revendeur). Un admin,
-- ou le service role (auth.uid() NULL), n'est jamais bloqué.
create or replace function public.sourcing_missions_require_plan()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'completed'
     and old.status is distinct from 'completed'
     and auth.uid() is not null
     and not public.is_admin()
     and not public.reseller_plan_allows(auth.uid(), 'sourcing') then
    raise exception 'Le sourcing sur mesure n''est pas inclus dans votre Pass Drops. Passez au Pass Revendeur pour valider une mission.';
  end if;
  return new;
end;
$$;

drop trigger if exists sourcing_missions_require_plan on public.b2b_sourcing_missions;
create trigger sourcing_missions_require_plan
  before update on public.b2b_sourcing_missions
  for each row execute function public.sourcing_missions_require_plan();

notify pgrst, 'reload schema';
