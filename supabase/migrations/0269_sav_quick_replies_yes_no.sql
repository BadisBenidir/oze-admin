-- ============================================================================
-- SAV : réponses rapides + question Oui / Non.
--
--   sav_quick_replies : réponses toutes faites de l'équipe (admin SAV →
--     Réponses rapides), insérées en un clic dans la zone de réponse.
--     yes_no = true : envoyée comme question Oui / Non.
--   sav_ticket_messages.yes_no / yes_no_answer : message de l'équipe avec
--     boutons Oui / Non côté client.
--   sav_admin_ask_yes_no(ticket, texte) : envoie la question (statut
--     « En attente client », email de réponse comme une réponse normale).
--   sav_client_answer_yes_no(message, 'yes'|'no') : réponse du client.
--     Non → message « Non, je n'ai plus besoin d'aide » + ticket fermé.
--     Oui → message « Oui, j'ai encore besoin d'aide » + ticket « En cours ».
-- ============================================================================

create table if not exists public.sav_quick_replies (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text not null default '',
  yes_no boolean not null default false,
  active boolean not null default true,
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.sav_quick_replies enable row level security;
drop policy if exists sav_quick_replies_admin_all on public.sav_quick_replies;
create policy sav_quick_replies_admin_all on public.sav_quick_replies
  for all using (public.is_admin()) with check (public.is_admin());

insert into public.sav_quick_replies (title, content, yes_no, position)
select v.title, v.content, v.yes_no, v.position
from (values
  ('Encore besoin d''aide ?', 'Avez-vous encore besoin d''aide sur cette demande ?', true, 10),
  ('Demande de photos', 'Pour avancer sur votre demande, pourriez-vous nous envoyer quelques photos de la pièce (vue d''ensemble et détails concernés) ? Vous pouvez les joindre directement ici avec le bouton « Joindre des fichiers ».', false, 20),
  ('Demande du numéro de commande', 'Pourriez-vous nous indiquer le numéro de la commande concernée (B2B-…) ? Vous le trouverez dans « Mon compte » → « Mes commandes ».', false, 30),
  ('On vérifie', 'Merci pour ces informations. Nous vérifions et revenons vers vous très vite.', false, 40),
  ('Comment demander la livraison', 'Pour recevoir vos pièces : « Mon compte » → « Mes commandes », cochez les pièces dans l''encadré « Prêts à être expédiés », cliquez sur « Demander la livraison », choisissez domicile ou point relais puis réglez les frais de port. Le numéro de suivi apparaîtra ensuite dans « Mes commandes ».', false, 50),
  ('Problème résolu', 'Bonne nouvelle : votre demande est réglée. N''hésitez pas à revenir vers nous si besoin.', false, 60)
) as v (title, content, yes_no, position)
where not exists (select 1 from public.sav_quick_replies);

alter table public.sav_ticket_messages add column if not exists yes_no boolean not null default false;
alter table public.sav_ticket_messages add column if not exists yes_no_answer text check (yes_no_answer in ('yes', 'no'));

create or replace function public.sav_admin_ask_yes_no(p_ticket_id uuid, p_content text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Accès refusé.';
  end if;
  if coalesce(trim(p_content), '') = '' then
    raise exception 'Question vide.';
  end if;
  if (select status from public.sav_tickets where id = p_ticket_id) = 'closed' then
    raise exception 'Ticket fermé : rouvrez-le pour poser une question.';
  end if;
  insert into public.sav_ticket_messages (ticket_id, author_type, author_id, content, yes_no)
  values (p_ticket_id, 'team', auth.uid(), trim(p_content), true)
  returning id into v_id;
  update public.sav_tickets set status = 'waiting_client' where id = p_ticket_id and status <> 'waiting_client';
  return v_id;
end;
$$;

create or replace function public.sav_client_answer_yes_no(p_message_id uuid, p_answer text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reseller uuid := public.current_reseller_id_incl_ended();
  v_msg public.sav_ticket_messages;
  v_status text;
begin
  if p_answer not in ('yes', 'no') then
    raise exception 'Réponse invalide.';
  end if;
  select m.* into v_msg
  from public.sav_ticket_messages m
  join public.sav_tickets t on t.id = m.ticket_id
  where m.id = p_message_id and m.yes_no and t.reseller_id = v_reseller
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

revoke all on function public.sav_admin_ask_yes_no(uuid, text) from public, anon;
revoke all on function public.sav_client_answer_yes_no(uuid, text) from public, anon;
grant execute on function public.sav_admin_ask_yes_no(uuid, text) to authenticated;
grant execute on function public.sav_client_answer_yes_no(uuid, text) to authenticated;

-- Vue client : + question Oui / Non (colonnes ajoutées en fin de vue).
create or replace view public.sav_my_ticket_messages as
select m.id, m.ticket_id, m.author_type, m.content, m.attachments, m.created_at,
  case when m.author_type = 'team' then 'Équipe OZË' else coalesce(nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''), 'Vous') end as author_name,
  m.yes_no, m.yes_no_answer
from public.sav_ticket_messages m
join public.sav_tickets t on t.id = m.ticket_id
left join public.profiles p on p.id = m.author_id
where not m.internal
  and m.author_type <> 'system'
  and t.reseller_id = public.current_reseller_id_incl_ended();

notify pgrst, 'reload schema';
