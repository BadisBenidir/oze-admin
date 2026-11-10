-- ============================================================================
-- SAV OZË, étape 2 : API tickets (fonctions SQL).
--
-- Client (pro.ozeparis.com, compte = current_reseller_id_incl_ended()) :
--   sav_create_ticket   : « Nouvelle demande » (formulaire Mes demandes)
--   sav_client_reply    : répondre sur un ticket (rouvre un ticket résolu /
--                         en attente client ; refusé s'il est fermé)
--   sav_mark_ticket_read: badge « nouvelle réponse » lu
-- Bot (service role, Edge Function sav-chat) :
--   sav_bot_create_ticket : ticket ouvert par le chatbot pour le client connecté
-- Équipe (is_admin()) :
--   sav_admin_reply, sav_admin_update_ticket, sav_admin_set_dispute
--   (admin_can('refunds')), sav_admin_counters, sav_admin_assignees
-- Toutes les écritures passent par ces fonctions ; le journal
-- (sav_ticket_events) est rempli par les triggers de 0263.
-- ============================================================================

-- Pièces jointes : au plus 5, chacune dans le dossier du compte revendeur.
create or replace function public.sav_check_attachments(p_attachments jsonb, p_reseller_id uuid, p_team boolean)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  v_item jsonb;
begin
  if p_attachments is null then
    return '[]'::jsonb;
  end if;
  if jsonb_typeof(p_attachments) <> 'array' or jsonb_array_length(p_attachments) > 5 then
    raise exception 'Pièces jointes invalides (5 maximum).';
  end if;
  for v_item in select * from jsonb_array_elements(p_attachments) loop
    if coalesce(v_item->>'path', '') = ''
       or (not p_team and split_part(v_item->>'path', '/', 1) <> p_reseller_id::text)
       or position('..' in v_item->>'path') > 0 then
      raise exception 'Pièce jointe invalide.';
    end if;
  end loop;
  return p_attachments;
end;
$$;

-- Création commune (client ou bot).
create or replace function public.sav_insert_ticket(
  p_reseller_id uuid,
  p_profile_id uuid,
  p_category text,
  p_subject text,
  p_message text,
  p_order_id uuid,
  p_attachments jsonb,
  p_priority text,
  p_source text,
  p_conversation_id uuid,
  p_ai_summary text
)
returns public.sav_tickets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket public.sav_tickets;
begin
  if p_reseller_id is null then
    raise exception 'Compte revendeur introuvable.';
  end if;
  if coalesce(trim(p_subject), '') = '' then
    raise exception 'Le sujet est obligatoire.';
  end if;
  if char_length(coalesce(p_message, '')) > 5000 then
    raise exception 'Message trop long (5 000 caractères maximum).';
  end if;
  if p_order_id is not null and not exists (
    select 1 from public.orders where id = p_order_id and reseller_id = p_reseller_id
  ) then
    raise exception 'Commande introuvable sur votre compte.';
  end if;
  if (select count(*) from public.sav_tickets
      where reseller_id = p_reseller_id and created_at > now() - interval '1 day') >= 5 then
    raise exception 'Vous avez déjà ouvert 5 demandes aujourd''hui. Répondez sur une demande existante ou réessayez demain.';
  end if;

  insert into public.sav_tickets (
    reseller_id, created_by_profile_id, order_id, category, subject, priority, source, conversation_id, ai_summary
  ) values (
    p_reseller_id, p_profile_id, p_order_id, coalesce(p_category, 'other'), left(trim(p_subject), 200),
    coalesce(p_priority, 'normal'), p_source, p_conversation_id, p_ai_summary
  )
  returning * into v_ticket;

  if coalesce(trim(p_message), '') <> '' or jsonb_array_length(coalesce(p_attachments, '[]'::jsonb)) > 0 then
    -- Ticket du chatbot : le 1er message est le résumé rédigé par le bot
    -- (message système, rattaché au fil et visible du client).
    insert into public.sav_ticket_messages (ticket_id, author_type, author_id, content, attachments)
    values (v_ticket.id, case when p_source = 'chatbot' then 'system' else 'client' end, p_profile_id, coalesce(trim(p_message), ''),
            public.sav_check_attachments(p_attachments, p_reseller_id, false));
  end if;

  if p_conversation_id is not null then
    update public.sav_chat_conversations set ticket_id = v_ticket.id where id = p_conversation_id;
  end if;

  return v_ticket;
end;
$$;

revoke all on function public.sav_insert_ticket(uuid, uuid, text, text, text, uuid, jsonb, text, text, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Client
-- ---------------------------------------------------------------------------
create or replace function public.sav_create_ticket(
  p_category text,
  p_subject text,
  p_message text,
  p_order_id uuid default null,
  p_attachments jsonb default '[]'::jsonb
)
returns table (id uuid, number text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket public.sav_tickets;
begin
  if coalesce(trim(p_message), '') = '' then
    raise exception 'Décrivez votre demande.';
  end if;
  v_ticket := public.sav_insert_ticket(
    public.current_reseller_id_incl_ended(), auth.uid(), p_category, p_subject, p_message,
    p_order_id, p_attachments, 'normal', 'form', null, null
  );
  return query select v_ticket.id, v_ticket.number;
end;
$$;

create or replace function public.sav_client_reply(p_ticket_id uuid, p_content text, p_attachments jsonb default '[]'::jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reseller uuid := public.current_reseller_id_incl_ended();
  v_ticket public.sav_tickets;
begin
  select * into v_ticket from public.sav_tickets where id = p_ticket_id and reseller_id = v_reseller for update;
  if not found then
    raise exception 'Demande introuvable.';
  end if;
  if v_ticket.status = 'closed' then
    raise exception 'Cette demande est fermée. Ouvrez une nouvelle demande si besoin.';
  end if;
  if coalesce(trim(p_content), '') = '' and jsonb_array_length(coalesce(p_attachments, '[]'::jsonb)) = 0 then
    raise exception 'Message vide.';
  end if;
  if char_length(coalesce(p_content, '')) > 5000 then
    raise exception 'Message trop long (5 000 caractères maximum).';
  end if;

  insert into public.sav_ticket_messages (ticket_id, author_type, author_id, content, attachments)
  values (p_ticket_id, 'client', auth.uid(), coalesce(trim(p_content), ''),
          public.sav_check_attachments(p_attachments, v_reseller, false));

  if v_ticket.status in ('waiting_client', 'resolved') then
    update public.sav_tickets set status = 'in_progress' where id = p_ticket_id;
  end if;
  update public.sav_tickets set last_client_read_at = now() where id = p_ticket_id;
end;
$$;

create or replace function public.sav_mark_ticket_read(p_ticket_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.sav_tickets
  set last_client_read_at = now()
  where id = p_ticket_id and reseller_id = public.current_reseller_id_incl_ended();
$$;

revoke all on function public.sav_create_ticket(text, text, text, uuid, jsonb) from public, anon;
revoke all on function public.sav_client_reply(uuid, text, jsonb) from public, anon;
revoke all on function public.sav_mark_ticket_read(uuid) from public, anon;
grant execute on function public.sav_create_ticket(text, text, text, uuid, jsonb) to authenticated;
grant execute on function public.sav_client_reply(uuid, text, jsonb) to authenticated;
grant execute on function public.sav_mark_ticket_read(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Bot (service role) : le compte et le profil viennent du JWT vérifié par
-- l'Edge Function, jamais du modèle.
-- ---------------------------------------------------------------------------
create or replace function public.sav_bot_create_ticket(
  p_reseller_id uuid,
  p_profile_id uuid,
  p_conversation_id uuid,
  p_category text,
  p_subject text,
  p_summary text,
  p_priority text,
  p_order_id uuid default null,
  p_attachments jsonb default '[]'::jsonb
)
returns table (id uuid, number text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket public.sav_tickets;
begin
  if not exists (
    select 1 from public.sav_chat_conversations
    where sav_chat_conversations.id = p_conversation_id
      and reseller_id = p_reseller_id and profile_id = p_profile_id
  ) then
    raise exception 'Conversation invalide.';
  end if;
  v_ticket := public.sav_insert_ticket(
    p_reseller_id, p_profile_id, p_category, p_subject, p_summary,
    p_order_id, p_attachments, p_priority, 'chatbot', p_conversation_id, null
  );
  return query select v_ticket.id, v_ticket.number;
end;
$$;

revoke all on function public.sav_bot_create_ticket(uuid, uuid, uuid, text, text, text, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.sav_bot_create_ticket(uuid, uuid, uuid, text, text, text, text, uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Équipe
-- ---------------------------------------------------------------------------
-- Réponse au client (internal = false) ou note interne (internal = true).
-- p_new_status : statut à appliquer en même temps (ex. 'waiting_client') ;
-- sans statut, un ticket « Nouveau » passe « En cours » à la 1re réponse.
create or replace function public.sav_admin_reply(
  p_ticket_id uuid,
  p_content text,
  p_internal boolean default false,
  p_attachments jsonb default '[]'::jsonb,
  p_new_status text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket public.sav_tickets;
  v_message_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Accès refusé.';
  end if;
  select * into v_ticket from public.sav_tickets where id = p_ticket_id for update;
  if not found then
    raise exception 'Ticket introuvable.';
  end if;
  if coalesce(trim(p_content), '') = '' and jsonb_array_length(coalesce(p_attachments, '[]'::jsonb)) = 0 then
    raise exception 'Message vide.';
  end if;

  insert into public.sav_ticket_messages (ticket_id, author_type, author_id, content, internal, attachments)
  values (p_ticket_id, 'team', auth.uid(), coalesce(trim(p_content), ''), coalesce(p_internal, false),
          public.sav_check_attachments(p_attachments, v_ticket.reseller_id, true))
  returning id into v_message_id;

  if p_new_status is not null and p_new_status <> v_ticket.status then
    update public.sav_tickets set status = p_new_status where id = p_ticket_id;
  elsif not coalesce(p_internal, false) and v_ticket.status = 'new' then
    update public.sav_tickets set status = 'in_progress' where id = p_ticket_id;
  end if;

  return v_message_id;
end;
$$;

-- Champs modifiables : status, priority, category, assigned_to, order_id,
-- subject, is_dispute. Clé absente = inchangé ; null explicite sur
-- assigned_to / order_id = retirer.
create or replace function public.sav_admin_update_ticket(p_ticket_id uuid, p_patch jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket public.sav_tickets;
begin
  if not public.is_admin() then
    raise exception 'Accès refusé.';
  end if;
  select * into v_ticket from public.sav_tickets where id = p_ticket_id for update;
  if not found then
    raise exception 'Ticket introuvable.';
  end if;

  if p_patch ? 'order_id' and p_patch->>'order_id' is not null and not exists (
    select 1 from public.orders where id = (p_patch->>'order_id')::uuid and reseller_id = v_ticket.reseller_id
  ) then
    raise exception 'Cette commande n''appartient pas à ce client.';
  end if;
  if p_patch ? 'assigned_to' and p_patch->>'assigned_to' is not null and not exists (
    select 1 from public.profiles p
    left join public.staff_permissions s on s.profile_id = p.id
    where p.id = (p_patch->>'assigned_to')::uuid
      and (p.role = 'admin' or (p.role = 'staff' and coalesce(s.active, false)))
  ) then
    raise exception 'Membre de l''équipe introuvable.';
  end if;

  update public.sav_tickets set
    status = case when p_patch ? 'status' then p_patch->>'status' else status end,
    priority = case when p_patch ? 'priority' then p_patch->>'priority' else priority end,
    category = case when p_patch ? 'category' then p_patch->>'category' else category end,
    subject = case when p_patch ? 'subject' then left(trim(p_patch->>'subject'), 200) else subject end,
    assigned_to = case when p_patch ? 'assigned_to' then (p_patch->>'assigned_to')::uuid else assigned_to end,
    order_id = case when p_patch ? 'order_id' then (p_patch->>'order_id')::uuid else order_id end,
    is_dispute = case when p_patch ? 'is_dispute' then (p_patch->>'is_dispute')::boolean else is_dispute end
  where id = p_ticket_id;
end;
$$;

-- Suivi du litige : montant concerné, décision, motif (droit « remboursements »).
create or replace function public.sav_admin_set_dispute(
  p_ticket_id uuid,
  p_amount numeric,
  p_decision text,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.admin_can('refunds') then
    raise exception 'Droit « remboursements » requis pour statuer sur un litige.';
  end if;
  update public.sav_tickets set
    is_dispute = true,
    dispute_amount = p_amount,
    dispute_decision = nullif(p_decision, ''),
    dispute_reason = nullif(trim(coalesce(p_reason, '')), '')
  where id = p_ticket_id;
  if not found then
    raise exception 'Ticket introuvable.';
  end if;
end;
$$;

create or replace function public.sav_admin_counters()
returns table (new_count int, open_count int, waiting_client_count int, urgent_count int, disputes_open_count int)
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
    count(*) filter (where is_dispute and status not in ('resolved', 'closed'))::int
  from public.sav_tickets
  where public.is_admin();
$$;

create or replace function public.sav_admin_assignees()
returns table (id uuid, name text, email text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id,
    coalesce(nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''), p.email),
    p.email
  from public.profiles p
  left join public.staff_permissions s on s.profile_id = p.id
  where public.is_admin()
    and (p.role = 'admin' or (p.role = 'staff' and coalesce(s.active, false)))
  order by p.role, 2;
$$;

revoke all on function public.sav_admin_reply(uuid, text, boolean, jsonb, text) from public, anon;
revoke all on function public.sav_admin_update_ticket(uuid, jsonb) from public, anon;
revoke all on function public.sav_admin_set_dispute(uuid, numeric, text, text) from public, anon;
revoke all on function public.sav_admin_counters() from public, anon;
revoke all on function public.sav_admin_assignees() from public, anon;
grant execute on function public.sav_admin_reply(uuid, text, boolean, jsonb, text) to authenticated;
grant execute on function public.sav_admin_update_ticket(uuid, jsonb) to authenticated;
grant execute on function public.sav_admin_set_dispute(uuid, numeric, text, text) to authenticated;
grant execute on function public.sav_admin_counters() to authenticated;
grant execute on function public.sav_admin_assignees() to authenticated;

notify pgrst, 'reload schema';
