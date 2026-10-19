-- ============================================================================
-- Coupure d'accès des membres de communauté non abonnés (0212, 0214).
--
-- À partir de la date d'application du prix de son groupe, un membre (pas le
-- contact principal) d'un groupe payant sans abonnement en cours perd l'accès :
-- écran « Accès suspendu » côté portail (CommunityPriceNotice) et, côté base,
-- plus d'achat (can_user_purchase, utilisée par b2b-checkout), ni d'enchères
-- ni de sourcing (reseller_plan_allows, triggers de 0167). Groupe à 0 €,
-- membre non classé et compte Club abonné : jamais bloqués. Accès rétabli
-- dès que l'abonnement est payé (webhook → community_sub_status).
-- ============================================================================

create or replace function public.community_access_blocked(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.reseller_contacts rc
    join public.resellers rs on rs.id = rc.reseller_id
    where rc.profile_id = p_user_id
      and not rc.is_primary
      and rc.member_group is not null
      and rs.account_type is distinct from 'subscriber'
      and coalesce(rc.community_sub_status, '') not in ('active', 'trialing', 'past_due')
      and coalesce((
        select p.monthly_price
        from public.community_group_prices p
        where p.reseller_id = rc.reseller_id
          and p.member_group = rc.member_group
          and p.effective_from <= current_date
        order by p.effective_from desc
        limit 1
      ), 0) > 0
  );
$$;

revoke all on function public.community_access_blocked(uuid) from public, anon;
grant execute on function public.community_access_blocked(uuid) to authenticated, service_role;

create or replace function public.can_user_purchase(p_user_id uuid default auth.uid())
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_user_id is null then
    return false;
  end if;
  if auth.uid() is not null and p_user_id <> auth.uid() and not public.is_admin() then
    raise exception 'Non autorisé';
  end if;
  return not public.has_overdue_auction_payment(p_user_id)
    and not public.community_access_blocked(p_user_id);
end;
$$;

create or replace function public.reseller_plan_allows(p_user_id uuid, p_feature text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not public.community_access_blocked(p_user_id)
  and (
    (
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
    )
  );
$$;

revoke all on function public.reseller_plan_allows(uuid, text) from public, anon;
grant execute on function public.reseller_plan_allows(uuid, text) to authenticated, service_role;

notify pgrst, 'reload schema';
