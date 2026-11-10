-- ============================================================================
-- Alerte achat immédiat (0260) : réservation et suivi des envois par
-- fonctions SQL plutôt que par des PATCH PostgREST sur
-- instant_buy_sale_alerts (rejetés en production avec « column
-- instant_buy_sale_alerts.claimed_at does not exist », alors que la colonne
-- existe et que les lectures passent).
-- Réservées au service role (Edge Function instant-buy-sale-alert).
-- ============================================================================

create or replace function public.claim_instant_buy_sale_alerts(p_max_attempts int default 5, p_claim_timeout interval default interval '2 minutes')
returns table (id uuid, product_id uuid, attempts int)
language sql
security definer
set search_path = public
as $$
  update public.instant_buy_sale_alerts a
  set claimed_at = now()
  where a.sent_at is null
    and a.attempts < p_max_attempts
    and (a.claimed_at is null or a.claimed_at < now() - p_claim_timeout)
  returning a.id, a.product_id, a.attempts;
$$;

create or replace function public.finish_instant_buy_sale_alert(p_id uuid, p_sent boolean, p_error text default null)
returns void
language sql
security definer
set search_path = public
as $$
  update public.instant_buy_sale_alerts
  set attempts = attempts + 1,
      sent_at = case when p_sent then now() else sent_at end,
      last_error = case when p_sent then null else left(p_error, 500) end,
      claimed_at = case when p_sent then claimed_at else null end
  where id = p_id;
$$;

revoke all on function public.claim_instant_buy_sale_alerts(int, interval) from public, anon, authenticated;
revoke all on function public.finish_instant_buy_sale_alert(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.claim_instant_buy_sale_alerts(int, interval) to service_role;
grant execute on function public.finish_instant_buy_sale_alert(uuid, boolean, text) to service_role;

notify pgrst, 'reload schema';
