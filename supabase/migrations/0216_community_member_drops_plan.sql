-- ============================================================================
-- Passage d'un membre de communauté abonné (0214) au Pass Drops.
--
-- Depuis Mon profil, le membre programme le passage au Pass Drops : à sa
-- prochaine échéance, son abonnement Stripe passe au prix public du Pass
-- Drops (planning Stripe, Edge Function community-subscription), puis le
-- webhook enregistre community_sub_plan = 'drops'. Comme pour un abonné
-- Club en Pass Drops, enchères et sourcing ne sont alors plus inclus
-- (reseller_plan_allows, utilisée par les triggers de 0167).
--   community_sub_plan         : 'community' (abonnement de la communauté) ou 'drops'
--   community_sub_pending_plan : 'drops' tant que le passage est programmé
-- ============================================================================

alter table public.reseller_contacts add column if not exists community_sub_plan text
  check (community_sub_plan is null or community_sub_plan in ('community', 'drops'));
alter table public.reseller_contacts add column if not exists community_sub_pending_plan text
  check (community_sub_pending_plan is null or community_sub_pending_plan = 'drops');

update public.reseller_contacts
set community_sub_plan = 'community'
where community_sub_stripe_subscription_id is not null and community_sub_plan is null;

create or replace function public.reseller_plan_allows(p_user_id uuid, p_feature text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (
    not exists (
      select 1
      from public.reseller_contacts rc
      join public.resellers rs on rs.id = rc.reseller_id
      where rc.profile_id = p_user_id
        and rs.account_type = 'subscriber'
        and rs.subscription_plan = 'drops'
        and p_feature in ('auctions', 'sourcing')
    )
    -- Membre de communauté passé au Pass Drops (abonnement en cours).
    and not exists (
      select 1
      from public.reseller_contacts rc
      where rc.profile_id = p_user_id
        and rc.community_sub_plan = 'drops'
        and rc.community_sub_status in ('active', 'trialing', 'past_due')
        and p_feature in ('auctions', 'sourcing')
    )
  )
  or (
    p_feature = 'auctions'
    and exists (
      select 1 from public.auction_access aa
      where aa.user_id = p_user_id and aa.valid_until > now()
    )
  );
$$;

revoke all on function public.reseller_plan_allows(uuid, text) from public, anon;
grant execute on function public.reseller_plan_allows(uuid, text) to authenticated, service_role;

notify pgrst, 'reload schema';
