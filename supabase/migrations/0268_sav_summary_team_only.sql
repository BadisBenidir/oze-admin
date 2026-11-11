-- ============================================================================
-- SAV : le résumé du chatbot n'est plus un message du fil.
--   - Il était visible du client (rédigé pour l'équipe : statut juridique,
--     autres commandes, points à vérifier…) et apparaissait en double dans
--     l'admin (bloc « Résumé IA » + 1er message).
--   - Désormais : résumé uniquement dans sav_tickets.ai_summary (équipe) ;
--     dans le fil, seulement les photos envoyées à l'assistant (message
--     client « Photos envoyées à l'assistant »).
--   - Tickets existants : messages système de résumé supprimés, ou convertis
--     en message « photos » s'ils portaient des photos.
-- ============================================================================

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


update public.sav_ticket_messages m
set author_type = 'client',
    content = 'Photos envoyées à l''assistant',
    author_id = t.created_by_profile_id
from public.sav_tickets t
where t.id = m.ticket_id and m.author_type = 'system' and t.source = 'chatbot'
  and jsonb_array_length(m.attachments) > 0;

delete from public.sav_ticket_messages m
using public.sav_tickets t
where t.id = m.ticket_id and m.author_type = 'system' and t.source = 'chatbot'
  and jsonb_array_length(m.attachments) = 0;

-- Client : jamais de message système dans « Mes demandes ».
create or replace view public.sav_my_ticket_messages as
select m.id, m.ticket_id, m.author_type, m.content, m.attachments, m.created_at,
  case when m.author_type = 'team' then 'Équipe OZË' else coalesce(nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''), 'Vous') end as author_name
from public.sav_ticket_messages m
join public.sav_tickets t on t.id = m.ticket_id
left join public.profiles p on p.id = m.author_id
where not m.internal
  and m.author_type <> 'system'
  and t.reseller_id = public.current_reseller_id_incl_ended();

notify pgrst, 'reload schema';
