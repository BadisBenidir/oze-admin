-- ============================================================================
-- SAV : proposition de remboursement détectée par l'IA.
--
--   sav_ticket_messages.action : message de l'équipe reconnu (sav-detect-action)
--     comme une proposition d'annulation / remboursement :
--     { type: 'refund', order_id, order_number, order_item_ids[], amount }.
--     Le message devient une question Oui / Non côté client.
--   sav_tickets.pending_action : proposition en cours sur le ticket, même
--     contenu + message_id, state ('proposed' | 'accepted' | 'declined' |
--     'done' | 'dismissed'), source de la réponse ('buttons' | 'ai'), quote.
--     « accepted » affiche à l'équipe le bouton « Annuler et rembourser » :
--     rien n'est jamais remboursé sans clic de l'équipe.
--   sav_client_answer_yes_no : réponse à une proposition de remboursement →
--     textes dédiés, « Non » ne ferme pas la demande.
--   sav_admin_set_pending_action(ticket, state, result) : l'équipe retire /
--     masque la proposition, ou la marque « faite » après le remboursement.
-- ============================================================================

alter table public.sav_ticket_messages add column if not exists action jsonb;
alter table public.sav_tickets add column if not exists pending_action jsonb;

create or replace function public.sav_client_answer_yes_no(p_message_id uuid, p_answer text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_msg public.sav_ticket_messages;
  v_status text;
  v_refund boolean;
  v_new_status text;
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

  v_refund := v_msg.action ->> 'type' = 'refund';
  v_new_status := case when p_answer = 'yes' or v_refund then 'in_progress' else 'closed' end;

  update public.sav_ticket_messages set yes_no_answer = p_answer where id = p_message_id;
  insert into public.sav_ticket_messages (ticket_id, author_type, author_id, content)
  values (
    v_msg.ticket_id, 'client', auth.uid(),
    case
      when v_refund and p_answer = 'yes' then 'Oui, j''accepte le remboursement.'
      when v_refund then 'Non, je ne souhaite pas être remboursé.'
      when p_answer = 'yes' then 'Oui, j''ai encore besoin d''aide.'
      else 'Non, je n''ai plus besoin d''aide. Merci !'
    end
  );
  update public.sav_tickets
  set status = v_new_status,
      last_client_read_at = now(),
      pending_action = case
        when v_refund and pending_action ->> 'message_id' = p_message_id::text
          then pending_action || jsonb_build_object(
            'state', case when p_answer = 'yes' then 'accepted' else 'declined' end,
            'source', 'buttons',
            'answered_at', now())
        else pending_action
      end
  where id = v_msg.ticket_id;
  return v_new_status;
end;
$$;

create or replace function public.sav_admin_set_pending_action(p_ticket_id uuid, p_state text, p_result jsonb default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Accès refusé.';
  end if;
  if p_state not in ('dismissed', 'done') then
    raise exception 'État invalide.';
  end if;
  if p_state = 'done' and not public.admin_can('refunds') then
    raise exception 'Droit « remboursements » requis.';
  end if;
  update public.sav_tickets
  set pending_action = coalesce(pending_action, '{}'::jsonb)
        || jsonb_build_object('state', p_state, 'closed_at', now(), 'closed_by', auth.uid())
        || case when p_result is not null then jsonb_build_object('result', p_result) else '{}'::jsonb end
  where id = p_ticket_id;
  -- Une proposition retirée ne doit plus porter de boutons côté client.
  if p_state = 'dismissed' then
    update public.sav_ticket_messages
    set yes_no = false
    where ticket_id = p_ticket_id and action is not null and yes_no_answer is null;
  end if;
end;
$$;

revoke all on function public.sav_admin_set_pending_action(uuid, text, jsonb) from public, anon;
grant execute on function public.sav_admin_set_pending_action(uuid, text, jsonb) to authenticated;

notify pgrst, 'reload schema';
