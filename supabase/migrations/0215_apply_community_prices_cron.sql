-- ============================================================================
-- Changement de prix d'un groupe appliqué aux membres déjà abonnés (0214) :
-- l'Edge Function apply-community-prices passe chaque heure et, une fois la
-- date d'application d'un nouveau prix atteinte, modifie le prix de leur
-- abonnement Stripe sans prorata (prochaine échéance au nouveau prix).
-- Idempotente : sans changement à appliquer, elle ne fait rien.
-- ============================================================================

do $$
begin
  perform cron.unschedule('apply-community-prices-hourly')
  where exists (select 1 from cron.job where jobname = 'apply-community-prices-hourly');

  perform cron.schedule(
    'apply-community-prices-hourly',
    '5 * * * *',
    $cron$
      select net.http_post(
        url := 'https://bmsasmqkmnlijpvoisep.supabase.co/functions/v1/apply-community-prices',
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body := '{}'::jsonb
      );
    $cron$
  );
end $$;
