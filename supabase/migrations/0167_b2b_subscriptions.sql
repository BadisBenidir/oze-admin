-- ============================================================================
-- Abonnements Club B2B souscrits depuis la landing publique pro.ozeparis.com.
--
-- Parcours :
--   landing → /inscription?pass=drops|revendeur (visiteur non connecté :
--   identité, mot de passe et adresse de FACTURATION, jamais d'infos
--   entreprise — le statut juridique se déclare ensuite dans « Mon profil »,
--   comme tout sous-compte)
--   → Edge Function b2b-signup : refuse tout email déjà utilisé (revendeur,
--     admin ou client du site principal : même base de comptes), crée le
--     compte de connexion (mot de passe choisi, aucun email d'invitation) et
--     un revendeur « abonné » (account_type = 'subscriber', status =
--     'pending', unique contact is_primary = false : tableau de bord de
--     sous-compte, sans équipe), puis ouvre une session Stripe Checkout.
--   → webhook b2b-stripe-webhook (checkout.session.completed, mode
--     subscription, metadata.type = 'b2b_subscription') : passe le revendeur
--     en 'active' et enregistre l'abonnement.
--   Les événements customer.subscription.updated/deleted tiennent ensuite à
--   jour le pass, l'échéance, la résiliation programmée — et coupent l'accès
--   (status = 'suspended') quand l'abonnement se termine.
--
-- Réabonnement : un abonné résilié (ou inscrit sans avoir payé) qui se
-- connecte voit une page dédiée (get_my_subscription_state ci-dessous, lisible
-- même compte suspendu) et relance une session Stripe sur le MÊME revendeur :
-- statut juridique, préférences, commandes et solde sont conservés.
--
-- Pass Drops : enchères et sourcing sur mesure non inclus. L'interface les
-- affiche verrouillés (avec passage au Pass Revendeur), et la base refuse
-- de toute façon une enchère ou la validation d'une mission (triggers
-- ci-dessous), même appelées directement.
-- ============================================================================

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

-- ----------------------------------------------------------------------------
-- État d'abonnement de l'utilisateur connecté, lisible même quand son
-- revendeur n'est pas actif (la RLS de resellers passe par
-- current_reseller_id(), qui ignore les comptes en attente ou suspendus) :
-- sert à la page « abonnement résilié / à finaliser » et à ses infos grisées.
-- ----------------------------------------------------------------------------
create or replace function public.get_my_subscription_state()
returns table (
  reseller_id uuid,
  account_type text,
  status text,
  subscription_plan text,
  subscription_status text,
  subscription_current_period_end timestamptz,
  first_name text,
  last_name text,
  email text,
  phone text,
  billing_address text,
  billing_postal_code text,
  billing_city text,
  billing_country text
)
language sql
security definer
stable
set search_path = public
as $$
  select rs.id, rs.account_type, rs.status, rs.subscription_plan, rs.subscription_status,
         rs.subscription_current_period_end,
         p.first_name, p.last_name, p.email, coalesce(p.phone, rs.contact_phone),
         rs.address, rs.postal_code, rs.city, rs.country
  from public.reseller_contacts rc
  join public.resellers rs on rs.id = rc.reseller_id
  join public.profiles p on p.id = rc.profile_id
  where rc.profile_id = auth.uid()
  limit 1;
$$;

revoke all on function public.get_my_subscription_state() from public, anon;
grant execute on function public.get_my_subscription_state() to authenticated;

notify pgrst, 'reload schema';
