-- SAV : alerte équipe (SAV_TEAM_EMAIL, sav@ozeparis.com) quand le client
-- répond sur une demande existante (message écrit ou réponse Oui / Non).
-- Le premier message d'un ticket reste couvert par 'team_new_ticket'.

alter table public.sav_email_outbox drop constraint if exists sav_email_outbox_kind_check;
alter table public.sav_email_outbox
  add constraint sav_email_outbox_kind_check
  check (kind in ('ticket_created', 'team_reply', 'resolved', 'team_new_ticket', 'client_reply'));

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
  elsif new.author_type = 'client'
    and exists (select 1 from public.sav_ticket_messages m where m.ticket_id = new.ticket_id and m.id <> new.id) then
    insert into public.sav_email_outbox (ticket_id, message_id, kind) values (new.ticket_id, new.id, 'client_reply');
    perform public.sav_ping_notify();
  end if;
  return new;
end;
$$;
