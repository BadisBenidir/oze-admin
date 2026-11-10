-- ============================================================================
-- Achat immédiat : date limite d'achat (date + heure) fixée par l'admin.
--
--   - b2b_feature_locks.ends_at (ligne 'instant_buy') ; null = sans limite ;
--   - l'espace pro affiche la date et le compte à rebours, puis « Vente
--     terminée » ;
--   - passée la date, instant_buy_locked() vaut vrai : les articles ne sont
--     plus visibles des revendeurs (comme une page bloquée) ;
--   - expire_instant_buy() (cron, chaque minute) passe les invendus en
--     'archived-instant-b2b'. Un article encore réservé dans un panier (y
--     compris pendant un paiement Stripe en cours) n'est archivé qu'à la fin
--     de sa réservation : jamais de paiement accepté sur un article archivé.
--   - fixer une nouvelle date dans le futur rouvre la vente.
-- ============================================================================

alter table public.b2b_feature_locks add column if not exists ends_at timestamptz;

create or replace function public.instant_buy_locked()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select locked or (ends_at is not null and ends_at <= now())
     from public.b2b_feature_locks where feature = 'instant_buy'),
    false
  );
$$;

create or replace function public.get_instant_buy_lock()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'locked', coalesce(l.locked, false),
    'message', l.message,
    'ends_at', l.ends_at,
    'ended', coalesce(l.ends_at <= now(), false),
    'server_now', now()
  )
  from (select 1) x
  left join public.b2b_feature_locks l on l.feature = 'instant_buy';
$$;

create or replace function public.admin_set_instant_buy_deadline(p_ends_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Accès refusé';
  end if;

  insert into public.b2b_feature_locks (feature, ends_at, updated_at)
  values ('instant_buy', p_ends_at, now())
  on conflict (feature) do update set ends_at = excluded.ends_at, updated_at = now();

  return public.get_instant_buy_lock();
end;
$$;

revoke all on function public.admin_set_instant_buy_deadline(timestamptz) from public, anon;
grant execute on function public.admin_set_instant_buy_deadline(timestamptz) to authenticated;

create or replace function public.expire_instant_buy()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
begin
  if not exists (
    select 1 from public.b2b_feature_locks
    where feature = 'instant_buy' and ends_at is not null and ends_at <= now()
  ) then
    return 0;
  end if;

  update public.products p
  set status = 'archived-instant-b2b'
  where p.status::text = 'instant-b2b'
    and not exists (
      select 1 from public.cart_items ci
      where ci.product_id = p.id and ci.expires_at is not null and ci.expires_at > now()
    );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.expire_instant_buy() from public, anon, authenticated;

select cron.unschedule('expire-instant-buy') where exists (select 1 from cron.job where jobname = 'expire-instant-buy');
select cron.schedule('expire-instant-buy', '* * * * *', 'select public.expire_instant_buy()');

notify pgrst, 'reload schema';
