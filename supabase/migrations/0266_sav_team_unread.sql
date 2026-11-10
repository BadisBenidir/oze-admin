-- ============================================================================
-- SAV : messages client non lus par l'équipe.
--   sav_tickets.last_team_read_at : dernière ouverture de la fiche dans
--   l'admin (partagée par toute l'équipe).
--   Non lu = nouveau ticket jamais ouvert, ou message du client postérieur à
--   la dernière ouverture.
--   sav_admin_mark_read(ticket) : appelé à l'ouverture de la fiche.
--   sav_admin_counters() renvoie aussi unread_count (pastille du menu SAV).
-- ============================================================================

alter table public.sav_tickets add column if not exists last_team_read_at timestamptz;

-- Tickets existants : déjà vus, sauf message client plus récent qu'une réponse.
update public.sav_tickets
set last_team_read_at = coalesce(last_team_message_at, now())
where last_team_read_at is null
  and (last_client_message_at is null or last_client_message_at <= coalesce(last_team_message_at, now()));

-- Trigger de 0263 : une lecture ne compte pas comme activité.
create or replace function public.sav_tickets_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year int := extract(year from now() at time zone 'Europe/Paris')::int;
  v_seq int;
begin
  if tg_op = 'INSERT' then
    insert into public.sav_ticket_counters as c (year, last_value)
    values (v_year, 1)
    on conflict (year) do update set last_value = c.last_value + 1
    returning last_value into v_seq;
    new.number := 'SAV-' || v_year || '-' || lpad(v_seq::text, 4, '0');
    if new.is_dispute is null then
      new.is_dispute := new.category in ('authenticity', 'return_refund', 'parcel_damaged_lost');
    end if;
  elsif new.last_team_read_at is distinct from old.last_team_read_at then
    -- Simple lecture par l'équipe (sav_admin_mark_read) : pas une activité.
    new.updated_at := old.updated_at;
  else
    new.updated_at := now();
    if new.is_dispute is null then
      new.is_dispute := false;
    end if;
  end if;

  if new.status = 'resolved' and (tg_op = 'INSERT' or old.status is distinct from 'resolved') then
    new.resolved_at := now();
  end if;
  return new;
end;
$$;

create or replace function public.sav_admin_mark_read(p_ticket_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Accès refusé.';
  end if;
  update public.sav_tickets set last_team_read_at = now() where id = p_ticket_id;
end;
$$;

drop function if exists public.sav_admin_counters();
create function public.sav_admin_counters()
returns table (new_count int, open_count int, waiting_client_count int, urgent_count int, disputes_open_count int, unread_count int)
language sql
stable
security definer
set search_path = public
as $$
  select
    count(*) filter (where status = 'new')::int,
    count(*) filter (where status in ('new', 'in_progress'))::int,
    count(*) filter (where status = 'waiting_client')::int,
    count(*) filter (where priority = 'urgent' and status not in ('resolved', 'closed'))::int,
    count(*) filter (where is_dispute and status not in ('resolved', 'closed'))::int,
    count(*) filter (where status <> 'closed' and (
      last_team_read_at is null
      or last_client_message_at > last_team_read_at
    ))::int
  from public.sav_tickets
  where public.is_admin();
$$;

revoke all on function public.sav_admin_mark_read(uuid) from public, anon;
revoke all on function public.sav_admin_counters() from public, anon;
grant execute on function public.sav_admin_mark_read(uuid) to authenticated;
grant execute on function public.sav_admin_counters() to authenticated;

notify pgrst, 'reload schema';
