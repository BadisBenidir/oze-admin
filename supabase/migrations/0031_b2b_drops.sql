-- ============================================================================
-- Module B2B Revendeurs — 31 : Drops planifiés
--
-- Un "drop" regroupe des articles actuellement en brouillon (status='draft')
-- et une date/heure de lancement. Une tâche pg_cron, exécutée chaque minute,
-- bascule automatiquement ces articles en 'for-sale-b2b' (visibles dans
-- b2b_catalog, donc dans le catalogue revendeur) dès l'échéance atteinte.
-- ============================================================================

create table if not exists public.drops (
  id uuid primary key default gen_random_uuid(),
  title text,
  scheduled_at timestamptz not null,
  product_ids uuid[] not null default array[]::uuid[],
  status text not null default 'planifie' check (status in ('planifie', 'publie', 'annule')),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  published_at timestamptz,
  constraint drops_product_ids_not_empty check (array_length(product_ids, 1) > 0)
);

create index if not exists drops_status_scheduled_at_idx on public.drops (status, scheduled_at);

alter table public.drops enable row level security;

drop policy if exists drops_admin_all on public.drops;
create policy drops_admin_all on public.drops
  for all using (public.is_admin()) with check (public.is_admin());

----------------------------------------------------------------------------
-- execute_due_drops : exécutée chaque minute par pg_cron. Bascule les
-- articles brouillon d'un drop échu en 'for-sale-b2b' et marque le drop
-- 'publie'. SECURITY DEFINER : contourne le RLS de `products`/`drops`
-- (le job cron ne s'exécute pas avec la session d'un admin connecté).
----------------------------------------------------------------------------
create or replace function public.execute_due_drops()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  due_drop record;
begin
  for due_drop in
    select id, product_ids
    from public.drops
    where status = 'planifie' and scheduled_at <= now()
    order by scheduled_at
  loop
    update public.products
    set status = 'for-sale-b2b'
    where id = any(due_drop.product_ids) and status = 'draft';

    update public.drops
    set status = 'publie', published_at = now()
    where id = due_drop.id;
  end loop;
end;
$$;

-- Le job cron s'exécute en tant que superuser (postgres), pas besoin d'un
-- grant execute côté rôles applicatifs — cette fonction n'est jamais
-- appelée depuis le client.
revoke all on function public.execute_due_drops() from public, anon, authenticated;

----------------------------------------------------------------------------
-- pg_cron : planifie l'exécution chaque minute. Si l'extension n'est pas
-- disponible sur ce projet (rare, dépend du plan/région Supabase), cette
-- section échoue sans bloquer le reste de la migration — vérifier alors
-- Database → Extensions → pg_cron dans le dashboard Supabase et relancer
-- uniquement le bloc ci-dessous.
----------------------------------------------------------------------------
do $$
begin
  create extension if not exists pg_cron with schema extensions;
exception when others then
  raise notice 'pg_cron indisponible automatiquement - a activer manuellement via Database > Extensions dans le dashboard Supabase.';
end $$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'execute-due-drops') then
    perform cron.unschedule('execute-due-drops');
  end if;
exception when others then
  null; -- pg_cron pas encore disponible : rien a desinscrire.
end $$;

do $$
begin
  perform cron.schedule('execute-due-drops', '* * * * *', 'select public.execute_due_drops()');
exception when others then
  raise notice 'Impossible de programmer execute-due-drops via pg_cron automatiquement - a faire manuellement une fois pg_cron active, via cron.schedule().';
end $$;

notify pgrst, 'reload schema';
