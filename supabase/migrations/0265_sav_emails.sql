-- ============================================================================
-- SAV OZË, étape 6 : emails (Resend, Edge Function sav-notify).
--
--   ticket_created   : confirmation au client (n° + lien vers la demande)
--   team_new_ticket  : alerte équipe (SAV_TEAM_EMAIL, « URGENT » si urgent)
--   team_reply       : « Nouvelle réponse à votre demande #… » (extrait + lien)
--   resolved         : la demande passe en « Résolu »
--
-- Les triggers ajoutent une ligne dans sav_email_outbox (0263) puis appellent
-- sav-notify (pg_net, asynchrone : jamais bloquant). Filet de sécurité : cron
-- toutes les 5 minutes tant qu'un email reste en attente. Réservation /
-- suivi des envois par fonctions SQL (mêmes raisons que 0261).
-- ============================================================================

create or replace function public.sav_ping_notify()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url := 'https://bmsasmqkmnlijpvoisep.supabase.co/functions/v1/sav-notify',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
exception when others then
  null; -- le cron rattrapera l'envoi
end;
$$;

create or replace function public.sav_enqueue_ticket_emails()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.sav_email_outbox (ticket_id, kind) values (new.id, 'ticket_created'), (new.id, 'team_new_ticket');
    perform public.sav_ping_notify();
  elsif new.status = 'resolved' and old.status is distinct from 'resolved' then
    insert into public.sav_email_outbox (ticket_id, kind) values (new.id, 'resolved');
    perform public.sav_ping_notify();
  end if;
  return new;
end;
$$;

drop trigger if exists sav_tickets_enqueue_emails on public.sav_tickets;
create trigger sav_tickets_enqueue_emails
  after insert or update of status on public.sav_tickets
  for each row execute function public.sav_enqueue_ticket_emails();

create or replace function public.sav_enqueue_reply_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.author_type = 'team' and not new.internal then
    insert into public.sav_email_outbox (ticket_id, message_id, kind) values (new.ticket_id, new.id, 'team_reply');
    perform public.sav_ping_notify();
  end if;
  return new;
end;
$$;

drop trigger if exists sav_messages_enqueue_email on public.sav_ticket_messages;
create trigger sav_messages_enqueue_email
  after insert on public.sav_ticket_messages
  for each row execute function public.sav_enqueue_reply_email();

-- Réservation des emails en attente (évite les doublons entre deux appels).
create or replace function public.sav_claim_emails(p_max_attempts int default 5, p_claim_timeout interval default interval '2 minutes')
returns table (id uuid, ticket_id uuid, message_id uuid, kind text, attempts int)
language sql
security definer
set search_path = public
as $$
  update public.sav_email_outbox o
  set claimed_at = now()
  where o.id in (
    select x.id from public.sav_email_outbox x
    where x.sent_at is null
      and x.attempts < p_max_attempts
      and (x.claimed_at is null or x.claimed_at < now() - p_claim_timeout)
    order by x.created_at
    limit 50
    for update skip locked
  )
  returning o.id, o.ticket_id, o.message_id, o.kind, o.attempts;
$$;

create or replace function public.sav_finish_email(p_id uuid, p_sent boolean, p_error text default null)
returns void
language sql
security definer
set search_path = public
as $$
  update public.sav_email_outbox
  set attempts = attempts + 1,
      sent_at = case when p_sent then now() else sent_at end,
      last_error = case when p_sent then null else left(p_error, 500) end,
      claimed_at = case when p_sent then claimed_at else null end
  where id = p_id;
$$;

revoke all on function public.sav_ping_notify() from public, anon, authenticated;
revoke all on function public.sav_claim_emails(int, interval) from public, anon, authenticated;
revoke all on function public.sav_finish_email(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.sav_claim_emails(int, interval) to service_role;
grant execute on function public.sav_finish_email(uuid, boolean, text) to service_role;

do $$
begin
  perform cron.unschedule('sav-notify-retry')
  where exists (select 1 from cron.job where jobname = 'sav-notify-retry');

  perform cron.schedule(
    'sav-notify-retry',
    '*/5 * * * *',
    $cron$
      select net.http_post(
        url := 'https://bmsasmqkmnlijpvoisep.supabase.co/functions/v1/sav-notify',
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body := '{}'::jsonb
      )
      where exists (select 1 from public.sav_email_outbox where sent_at is null and attempts < 5);
    $cron$
  );
end $$;

notify pgrst, 'reload schema';
