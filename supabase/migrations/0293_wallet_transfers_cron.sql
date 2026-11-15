-- Rechargements par virement crédités quasi instantanément (0292) : synchro
-- légère des virements entrants récents (qonto-wallet-transfers) chaque
-- minute. Avec un virement instantané (SEPA Instant), le solde du membre est
-- crédité en 1 à 2 minutes. La synchro complète qonto-sync reste à 6 h / 18 h.

do $$
begin
  perform cron.unschedule('qonto-wallet-transfers');
exception when others then
  null;
end $$;

select cron.schedule(
  'qonto-wallet-transfers',
  '* * * * *',
  $cron$
    select net.http_post(
      url := 'https://bmsasmqkmnlijpvoisep.supabase.co/functions/v1/qonto-wallet-transfers',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
  $cron$
);
