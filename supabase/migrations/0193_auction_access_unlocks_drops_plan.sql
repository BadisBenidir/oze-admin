-- ============================================================================
-- Enchères offertes à un abonné Pass Drops (découverte).
--
-- Le Pass Drops n'inclut pas les enchères (reseller_plan_allows, 0167). Un
-- accès offert par l'admin (Enchères B2B → « Offrir un accès », table
-- auction_access, 0104) les débloque jusqu'à sa date de fin (fin de la session
-- choisie) : page Enchères visible et enchères autorisées. Le sourcing reste
-- réservé au Pass Revendeur.
-- ============================================================================

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
