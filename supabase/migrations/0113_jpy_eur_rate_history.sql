-- ============================================================================
-- Historique du taux de change JPY -> EUR, alimenté côté serveur (edge
-- function fetch-jpy-eur-rate, appelée quotidiennement par pg_cron) plutôt
-- que par un appel direct du navigateur à une API tierce (CreateProduct.tsx
-- appelait jusqu'ici api.frankfurter.app depuis le client, peu fiable selon
-- le réseau de l'utilisateur — voir échanges précédents).
--
-- Une ligne par JOUR (rate_date unique) : tous les articles créés le même
-- jour utilisent donc le même taux, peu importe combien de fois la fonction
-- est rappelée dans la journée (upsert sur rate_date côté edge function).
-- ============================================================================

create table if not exists public.jpy_eur_rates (
  id uuid primary key default gen_random_uuid(),
  rate_date date not null unique,
  rate numeric(14, 8) not null check (rate > 0),
  fetched_at timestamptz not null default now()
);

create index if not exists jpy_eur_rates_rate_date_idx on public.jpy_eur_rates (rate_date desc);

alter table public.jpy_eur_rates enable row level security;

drop policy if exists jpy_eur_rates_admin_all on public.jpy_eur_rates;
create policy jpy_eur_rates_admin_all on public.jpy_eur_rates
  for all using (public.is_admin()) with check (public.is_admin());

revoke all on public.jpy_eur_rates from public, authenticated;
grant select, insert, update, delete on public.jpy_eur_rates to authenticated;

-- ----------------------------------------------------------------------------
-- pg_cron + pg_net : appelle l'edge function fetch-jpy-eur-rate chaque jour à
-- 6h UTC (avant le début de journée en France). Suit le même schéma de garde
-- que execute_due_drops (0031_b2b_drops.sql) : une extension ou un
-- cron.schedule indisponible ne bloque jamais le reste de la migration.
--
-- ⚠️ ACTION MANUELLE REQUISE : remplacer <PROJECT_REF> ci-dessous par la
-- référence de ce projet Supabase (Project Settings > General, ou dans
-- l'URL du dashboard : supabase.com/dashboard/project/<PROJECT_REF>) AVANT
-- d'exécuter cette migration. Si la fonction n'est pas encore déployée
-- (`supabase functions deploy fetch-jpy-eur-rate`), le job échouera
-- silencieusement chaque jour jusqu'au déploiement — sans casser autre chose.
-- ----------------------------------------------------------------------------
do $$
begin
  create extension if not exists pg_net with schema extensions;
exception when others then
  raise notice 'pg_net indisponible automatiquement — à activer manuellement via Database > Extensions dans le dashboard Supabase.';
end $$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'fetch-jpy-eur-rate-daily') then
    perform cron.unschedule('fetch-jpy-eur-rate-daily');
  end if;
exception when others then
  null; -- pg_cron pas encore disponible : rien à désinscrire.
end $$;

do $$
begin
  perform cron.schedule(
    'fetch-jpy-eur-rate-daily',
    '0 6 * * *',
    $cron$
      select net.http_post(
        url := 'https://<PROJECT_REF>.supabase.co/functions/v1/fetch-jpy-eur-rate',
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body := '{}'::jsonb
      );
    $cron$
  );
exception when others then
  raise notice 'Impossible de programmer fetch-jpy-eur-rate-daily automatiquement — à faire manuellement une fois pg_net/pg_cron actifs et <PROJECT_REF> remplacé, via cron.schedule().';
end $$;

notify pgrst, 'reload schema';
