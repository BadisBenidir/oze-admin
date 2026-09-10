-- ============================================================================
-- Rattrapage d'historique pour "Statistiques B2B" (0125) : reseller_daily_
-- sessions ne commence à se remplir qu'à partir du déploiement du tracking
-- en direct — sans ça, le graphique démarre totalement vide. Cette fonction
-- reconstitue une ESTIMATION de l'activité passée à partir de trois signaux
-- déjà en base (jamais un vrai comptage de visiteurs uniques, juste un
-- repère en attendant que le tracking réel s'accumule) :
--   - commandes B2B passées (orders.created_at, via placed_by_profile_id)
--   - recharges/achats de portefeuille (wallet_transactions.created_at)
--   - dernière connexion connue (auth.users.last_sign_in_at) — UN SEUL jour
--     par revendeur, Supabase ne conserve pas l'historique complet des
--     connexions, seulement la plus récente : ce signal ne peut contribuer
--     qu'à une seule date par personne, pas à un étalement dans le temps.
--
-- security definer nécessaire : auth.users n'est jamais lisible depuis un
-- client normal (PostgREST), seule une fonction posée par le rôle
-- propriétaire de la migration peut la lire. Réservé aux admins (même
-- withstanding que reseller_daily_sessions_admin_select, 0125) car cette
-- fonction contourne entièrement RLS.
-- ============================================================================

create or replace function public.backfill_reseller_daily_activity(p_days int default 30)
returns table (activity_date date, profile_count int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window_start date := (current_date - (greatest(p_days, 1) - 1));
begin
  if not public.is_admin() then
    raise exception 'Accès refusé';
  end if;

  return query
  with order_activity as (
    select o.placed_by_profile_id as profile_id, o.created_at::date as activity_date
    from public.orders o
    where o.order_channel = 'b2b'
      and o.placed_by_profile_id is not null
      and o.created_at::date >= v_window_start
  ),
  wallet_activity as (
    select wt.profile_id, wt.created_at::date as activity_date
    from public.wallet_transactions wt
    where wt.created_at::date >= v_window_start
  ),
  signin_activity as (
    -- Un seul point par revendeur (dernière connexion connue) — ne reflète
    -- jamais un historique de connexions répétées, juste la plus récente.
    select p.id as profile_id, u.last_sign_in_at::date as activity_date
    from auth.users u
    join public.profiles p on p.id = u.id
    where p.role = 'reseller'
      and u.last_sign_in_at is not null
      and u.last_sign_in_at::date >= v_window_start
  ),
  combined as (
    select profile_id, activity_date from order_activity
    union
    select profile_id, activity_date from wallet_activity
    union
    select profile_id, activity_date from signin_activity
  )
  select c.activity_date, count(distinct c.profile_id)::int as profile_count
  from combined c
  group by c.activity_date
  order by c.activity_date;
end;
$$;

grant execute on function public.backfill_reseller_daily_activity(int) to authenticated;

notify pgrst, 'reload schema';
