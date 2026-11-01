-- ============================================================================
-- Frais d'expédition Sendcloud en comptabilité.
-- Les factures Sendcloud (étiquettes, surcharges…) sont relues chaque nuit
-- par l'Edge Function sync-sendcloud-costs et rangées ici ; Comptabilité &
-- Finances les déduit de la marge brute, par mois de facture (montant HT).
-- ============================================================================

create table if not exists public.sendcloud_invoices (
  id text primary key,
  ref text,
  invoice_date date not null,
  price_excl numeric(12, 2) not null default 0,
  price_incl numeric(12, 2) not null default 0,
  type text,
  is_paid boolean,
  raw jsonb,
  synced_at timestamptz not null default now()
);

create index if not exists sendcloud_invoices_date_idx on public.sendcloud_invoices (invoice_date);

alter table public.sendcloud_invoices enable row level security;

drop policy if exists sendcloud_invoices_admin_select on public.sendcloud_invoices;
create policy sendcloud_invoices_admin_select on public.sendcloud_invoices
  for select using (public.is_admin());

do $$
begin
  perform cron.unschedule('sync-sendcloud-costs-daily')
  where exists (select 1 from cron.job where jobname = 'sync-sendcloud-costs-daily');

  perform cron.schedule(
    'sync-sendcloud-costs-daily',
    '30 5 * * *',
    $cron$
      select net.http_post(
        url := 'https://bmsasmqkmnlijpvoisep.supabase.co/functions/v1/sync-sendcloud-costs',
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body := '{}'::jsonb
      );
    $cron$
  );
end $$;

notify pgrst, 'reload schema';
