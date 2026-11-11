-- ============================================================================
-- SAV : cloisonnement PAR PERSONNE (et non plus par compte revendeur).
--
-- Un compte revendeur peut regrouper des dizaines de personnes (communauté
-- partenaire comme Aurel Vinted, équipe d'une société) : chacun ne doit voir
-- que SES demandes, SES messages et SES fichiers.
--   - vues sav_my_tickets / sav_my_ticket_messages : created_by_profile_id ;
--   - réponses, lecture, Oui / Non : uniquement sur ses propres demandes ;
--   - fichiers (bucket sav-attachments) : lisibles par la personne qui les a
--     déposés, ou par le client d'une demande où ils sont joints ;
--   - limite de 5 demandes par jour : par personne.
-- ============================================================================

create or replace view public.sav_my_tickets as
select
  t.id, t.number, t.order_id, o.order_number, t.category, t.subject, t.status,
  t.source, t.conversation_id, t.created_at, t.updated_at,
  t.last_client_message_at, t.last_team_message_at, t.last_client_read_at, t.resolved_at,
  greatest(t.created_at, t.last_client_message_at, t.last_team_message_at) as last_activity_at,
  (t.last_team_message_at is not null
    and (t.last_client_read_at is null or t.last_team_message_at > t.last_client_read_at)) as has_new_reply
from public.sav_tickets t
left join public.orders o on o.id = t.order_id
where t.reseller_id = public.current_reseller_id_incl_ended()
  and t.created_by_profile_id = auth.uid();

create or replace view public.sav_my_ticket_messages as
select m.id, m.ticket_id, m.author_type, m.content, m.attachments, m.created_at,
  case when m.author_type = 'team' then 'Équipe OZË' else coalesce(nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''), 'Vous') end as author_name,
  m.yes_no, m.yes_no_answer
from public.sav_ticket_messages m
join public.sav_tickets t on t.id = m.ticket_id
left join public.profiles p on p.id = m.author_id
where not m.internal
  and m.author_type <> 'system'
  and t.reseller_id = public.current_reseller_id_incl_ended()
  and t.created_by_profile_id = auth.uid();

-- Ticket du client connecté (sinon null).
create or replace function public.sav_my_ticket_id(p_ticket_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.sav_tickets
  where id = p_ticket_id
    and created_by_profile_id = auth.uid()
    and reseller_id = public.current_reseller_id_incl_ended();
$$;
revoke all on function public.sav_my_ticket_id(uuid) from public, anon;
grant execute on function public.sav_my_ticket_id(uuid) to authenticated;

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
  select * into v_ticket from public.sav_tickets
  where id = p_ticket_id and reseller_id = v_reseller and created_by_profile_id = auth.uid()
  for update;
  if not found then
    raise exception 'Demande introuvable.';
  end if;
  if v_ticket.status = 'closed' then
    raise exception 'Cette demande est fermée.';
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
  where id = public.sav_my_ticket_id(p_ticket_id);
$$;

create or replace function public.sav_client_answer_yes_no(p_message_id uuid, p_answer text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_msg public.sav_ticket_messages;
  v_status text;
begin
  if p_answer not in ('yes', 'no') then
    raise exception 'Réponse invalide.';
  end if;
  select m.* into v_msg
  from public.sav_ticket_messages m
  where m.id = p_message_id and m.yes_no and public.sav_my_ticket_id(m.ticket_id) is not null
  for update of m;
  if not found then
    raise exception 'Question introuvable.';
  end if;
  if v_msg.yes_no_answer is not null then
    raise exception 'Vous avez déjà répondu à cette question.';
  end if;
  select status into v_status from public.sav_tickets where id = v_msg.ticket_id;
  if v_status = 'closed' then
    raise exception 'Cette demande est fermée.';
  end if;

  update public.sav_ticket_messages set yes_no_answer = p_answer where id = p_message_id;
  insert into public.sav_ticket_messages (ticket_id, author_type, author_id, content)
  values (
    v_msg.ticket_id, 'client', auth.uid(),
    case when p_answer = 'yes' then 'Oui, j''ai encore besoin d''aide.' else 'Non, je n''ai plus besoin d''aide. Merci !' end
  );
  update public.sav_tickets
  set status = case when p_answer = 'yes' then 'in_progress' else 'closed' end,
      last_client_read_at = now()
  where id = v_msg.ticket_id;
  return case when p_answer = 'yes' then 'in_progress' else 'closed' end;
end;
$$;

-- Fichiers : la personne qui les a déposés, ou le client d'une demande où
-- ils sont joints (réponses de l'équipe) — plus tout le dossier du compte.
drop policy if exists sav_attachments_client_select on storage.objects;
create policy sav_attachments_client_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'sav-attachments'
    and (
      owner_id = auth.uid()::text
      or exists (
        select 1
        from public.sav_ticket_messages m
        join public.sav_tickets t on t.id = m.ticket_id
        where t.created_by_profile_id = auth.uid()
          and not m.internal
          and m.attachments @> jsonb_build_array(jsonb_build_object('path', storage.objects.name))
      )
    )
  );

-- Limite de 5 demandes par jour : par personne.
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
      where created_by_profile_id = p_profile_id and created_at > now() - interval '1 day') >= 5 then
    raise exception 'Vous avez déjà ouvert 5 demandes aujourd''hui. Répondez sur une demande existante ou réessayez demain.';
  end if;

  insert into public.sav_tickets (
    reseller_id, created_by_profile_id, order_id, category, subject, priority, source, conversation_id, ai_summary
  ) values (
    p_reseller_id, p_profile_id, p_order_id, coalesce(p_category, 'other'), left(trim(p_subject), 200),
    coalesce(p_priority, 'normal'), p_source, p_conversation_id, p_ai_summary
  )
  returning * into v_ticket;

  if p_source = 'chatbot' then
    -- Ticket du chatbot : le résumé du bot reste réservé à l'équipe
    -- (sav_tickets.ai_summary) ; seul un message avec les photos envoyées à
    -- l'assistant est ajouté au fil (le client voit sa conversation à part).
    if jsonb_array_length(coalesce(p_attachments, '[]'::jsonb)) > 0 then
      insert into public.sav_ticket_messages (ticket_id, author_type, author_id, content, attachments)
      values (v_ticket.id, 'client', p_profile_id, 'Photos envoyées à l''assistant',
              public.sav_check_attachments(p_attachments, p_reseller_id, false));
    end if;
  elsif coalesce(trim(p_message), '') <> '' or jsonb_array_length(coalesce(p_attachments, '[]'::jsonb)) > 0 then
    insert into public.sav_ticket_messages (ticket_id, author_type, author_id, content, attachments)
    values (v_ticket.id, 'client', p_profile_id, coalesce(trim(p_message), ''),
            public.sav_check_attachments(p_attachments, p_reseller_id, false));
  end if;

  if p_conversation_id is not null then
    update public.sav_chat_conversations set ticket_id = v_ticket.id where id = p_conversation_id;
  end if;

  return v_ticket;
end;
$$;

notify pgrst, 'reload schema';
