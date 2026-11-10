-- ============================================================================
-- SAV OZË : tickets d'assistance + chatbot IA (pro.ozeparis.com) et onglet
-- SAV de l'admin. Étape 1 : schéma.
--
--   sav_tickets           : une demande (n° lisible SAV-2026-0042), liée au
--                           compte revendeur, éventuellement à une commande ;
--                           volet litige (montant, décision, motif).
--   sav_ticket_messages   : fil client / équipe / système ; internal = note
--                           interne, jamais visible du client.
--   sav_ticket_events     : journal (qui a fait quoi, quand), alimenté par
--                           triggers — impossible d'oublier une entrée.
--   sav_chat_conversations / sav_chat_messages : historique complet du bot.
--   sav_knowledge_base    : base de connaissances du bot, éditable dans
--                           l'admin (SAV → Base de connaissances).
--   sav_rate_limits       : compteurs anti-abus du chatbot.
--   sav_email_outbox      : file d'emails (confirmation, réponse, résolu,
--                           alerte équipe), envoyée par l'Edge Function
--                           sav-notify avec relance (comme 0260).
--   bucket sav-attachments : photos (preuves), privé, rangé par revendeur.
--
-- Accès client : uniquement par les vues sav_my_* (filtrées sur
-- current_reseller_id_incl_ended(), notes internes et champs litige exclus)
-- et par les fonctions de l'étape 2. Aucune policy client sur les tables.
-- Accès équipe : is_admin().
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Tickets
-- ---------------------------------------------------------------------------
create table if not exists public.sav_ticket_counters (
  year int primary key,
  last_value int not null default 0
);
alter table public.sav_ticket_counters enable row level security;

create table if not exists public.sav_tickets (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  reseller_id uuid not null references public.resellers (id) on delete cascade,
  created_by_profile_id uuid references public.profiles (id) on delete set null,
  order_id uuid references public.orders (id) on delete set null,
  category text not null default 'other' check (category in (
    'order_delivery',       -- Commande / livraison
    'parcel_damaged_lost',  -- Colis endommagé ou perdu
    'authenticity',         -- Authenticité
    'return_refund',        -- Retour / remboursement
    'payment',              -- Paiement
    'subscription',         -- Abonnement Club B2B
    'sourcing',             -- Sourcing sur mesure
    'other'                 -- Autre
  )),
  subject text not null check (char_length(subject) between 1 and 200),
  status text not null default 'new' check (status in ('new', 'in_progress', 'waiting_client', 'resolved', 'closed')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  assigned_to uuid references public.profiles (id) on delete set null,
  source text not null default 'form' check (source in ('chatbot', 'form', 'admin')),
  is_dispute boolean,
  dispute_amount numeric(10, 2) check (dispute_amount is null or dispute_amount >= 0),
  dispute_decision text check (dispute_decision in ('accepted', 'refused', 'partial')),
  dispute_reason text,
  conversation_id uuid,
  ai_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_client_message_at timestamptz,
  last_team_message_at timestamptz,
  last_client_read_at timestamptz,
  resolved_at timestamptz
);

create index if not exists sav_tickets_reseller_idx on public.sav_tickets (reseller_id, created_at desc);
create index if not exists sav_tickets_status_idx on public.sav_tickets (status, priority);
create index if not exists sav_tickets_order_idx on public.sav_tickets (order_id) where order_id is not null;
create index if not exists sav_tickets_dispute_idx on public.sav_tickets (created_at desc) where is_dispute;

-- N° lisible SAV-AAAA-NNNN (compteur remis à zéro chaque année), litige par
-- défaut selon la catégorie, updated_at / resolved_at.
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

drop trigger if exists sav_tickets_before_write on public.sav_tickets;
create trigger sav_tickets_before_write
  before insert or update on public.sav_tickets
  for each row execute function public.sav_tickets_before_write();

-- ---------------------------------------------------------------------------
-- Messages
-- ---------------------------------------------------------------------------
create table if not exists public.sav_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.sav_tickets (id) on delete cascade,
  author_type text not null check (author_type in ('client', 'team', 'system')),
  author_id uuid references public.profiles (id) on delete set null,
  content text not null default '' check (char_length(content) <= 10000),
  internal boolean not null default false,
  -- [{ "path": "<reseller_id>/…", "name": "photo.jpg", "type": "image/jpeg", "size": 12345 }]
  attachments jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array'),
  created_at timestamptz not null default now(),
  constraint sav_ticket_messages_internal_team check (not internal or author_type = 'team')
);

create index if not exists sav_ticket_messages_ticket_idx on public.sav_ticket_messages (ticket_id, created_at);

-- Dernière activité client / équipe sur le ticket.
create or replace function public.sav_ticket_messages_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.internal then
    update public.sav_tickets set updated_at = now() where id = new.ticket_id;
  elsif new.author_type = 'client' then
    update public.sav_tickets set last_client_message_at = new.created_at where id = new.ticket_id;
  elsif new.author_type = 'team' then
    update public.sav_tickets set last_team_message_at = new.created_at where id = new.ticket_id;
  else
    update public.sav_tickets set updated_at = now() where id = new.ticket_id;
  end if;
  return new;
end;
$$;

drop trigger if exists sav_ticket_messages_after_insert on public.sav_ticket_messages;
create trigger sav_ticket_messages_after_insert
  after insert on public.sav_ticket_messages
  for each row execute function public.sav_ticket_messages_after_insert();

-- ---------------------------------------------------------------------------
-- Journal
-- ---------------------------------------------------------------------------
create table if not exists public.sav_ticket_events (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.sav_tickets (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null, -- null = bot / système
  action text not null,   -- created, status, priority, category, assigned_to, dispute, order, reply, note, client_reply
  old_value text,
  new_value text,
  created_at timestamptz not null default now()
);

create index if not exists sav_ticket_events_ticket_idx on public.sav_ticket_events (ticket_id, created_at);

create or replace function public.sav_tickets_log_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    insert into public.sav_ticket_events (ticket_id, actor_id, action, new_value)
    values (new.id, v_actor, 'created', new.source);
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.sav_ticket_events (ticket_id, actor_id, action, old_value, new_value)
    values (new.id, v_actor, 'status', old.status, new.status);
  end if;
  if new.priority is distinct from old.priority then
    insert into public.sav_ticket_events (ticket_id, actor_id, action, old_value, new_value)
    values (new.id, v_actor, 'priority', old.priority, new.priority);
  end if;
  if new.category is distinct from old.category then
    insert into public.sav_ticket_events (ticket_id, actor_id, action, old_value, new_value)
    values (new.id, v_actor, 'category', old.category, new.category);
  end if;
  if new.assigned_to is distinct from old.assigned_to then
    insert into public.sav_ticket_events (ticket_id, actor_id, action, old_value, new_value)
    values (new.id, v_actor, 'assigned_to', old.assigned_to::text, new.assigned_to::text);
  end if;
  if new.order_id is distinct from old.order_id then
    insert into public.sav_ticket_events (ticket_id, actor_id, action, old_value, new_value)
    values (new.id, v_actor, 'order', old.order_id::text, new.order_id::text);
  end if;
  if (new.is_dispute, new.dispute_amount, new.dispute_decision, new.dispute_reason)
     is distinct from (old.is_dispute, old.dispute_amount, old.dispute_decision, old.dispute_reason) then
    insert into public.sav_ticket_events (ticket_id, actor_id, action, old_value, new_value)
    values (
      new.id, v_actor, 'dispute',
      concat_ws(' · ', case when old.is_dispute then 'litige' end, old.dispute_amount::text, old.dispute_decision),
      concat_ws(' · ', case when new.is_dispute then 'litige' end, new.dispute_amount::text, new.dispute_decision)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists sav_tickets_log_events on public.sav_tickets;
create trigger sav_tickets_log_events
  after insert or update on public.sav_tickets
  for each row execute function public.sav_tickets_log_events();

create or replace function public.sav_messages_log_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.author_type <> 'system' then
    insert into public.sav_ticket_events (ticket_id, actor_id, action)
    values (
      new.ticket_id,
      new.author_id,
      case when new.internal then 'note' when new.author_type = 'team' then 'reply' else 'client_reply' end
    );
  end if;
  return new;
end;
$$;

drop trigger if exists sav_messages_log_events on public.sav_ticket_messages;
create trigger sav_messages_log_events
  after insert on public.sav_ticket_messages
  for each row execute function public.sav_messages_log_events();

-- ---------------------------------------------------------------------------
-- Chatbot
-- ---------------------------------------------------------------------------
create table if not exists public.sav_chat_conversations (
  id uuid primary key default gen_random_uuid(),
  reseller_id uuid not null references public.resellers (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  ticket_id uuid references public.sav_tickets (id) on delete set null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

create index if not exists sav_chat_conversations_profile_idx on public.sav_chat_conversations (profile_id, last_message_at desc);

alter table public.sav_tickets drop constraint if exists sav_tickets_conversation_fk;
alter table public.sav_tickets
  add constraint sav_tickets_conversation_fk
  foreign key (conversation_id) references public.sav_chat_conversations (id) on delete set null;

create table if not exists public.sav_chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.sav_chat_conversations (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  -- Blocs Anthropic complets (texte, tool_use, tool_result) pour rejouer la conversation.
  content jsonb not null,
  -- Texte affiché (vide pour un tour purement outil).
  display_text text not null default '',
  attachments jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array'),
  input_tokens int,
  output_tokens int,
  created_at timestamptz not null default now()
);

create index if not exists sav_chat_messages_conversation_idx on public.sav_chat_messages (conversation_id, created_at);

-- ---------------------------------------------------------------------------
-- Base de connaissances
-- ---------------------------------------------------------------------------
create table if not exists public.sav_knowledge_base (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text not null default '',
  active boolean not null default true,
  position int not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

insert into public.sav_knowledge_base (title, content, position)
select v.title, v.content, v.position
from (values
  ('Authenticité', 'Chaque pièce passe 3 contrôles d''authenticité : aux maisons d''enchères japonaises, chez nos partenaires au Japon avant l''expédition, puis dans nos locaux en France.', 10),
  ('Certificat Entrupy', 'Le certificat Entrupy est une option facultative, choisie au moment de la commande.', 20),
  ('Pièce non authentique', 'Si une pièce s''avère non authentique, elle est remboursée intégralement via la garantie AACD.', 30),
  ('Grades', 'Les grades d''état sont : S, A, AB, B, BC, C (usure importante), D (pièce à restaurer).', 40),
  ('Délais', '2 semaines maximum entre l''achat au Japon et l''arrivée dans nos locaux en France. Puis 3 jours maximum de contrôle, validation et expédition. Puis 2 à 4 jours ouvrés de livraison.', 50),
  ('Sourcing sur mesure', 'Délais au cas par cas : aucun délai fixe n''est promis. Le client peut retirer une pièce à tout moment tant que la mission de sourcing n''est pas terminée.', 60),
  ('Club B2B', 'Le compte et l''abonnement d''un particulier dont la réclamation de retour s''avère infondée peuvent être suspendus ou non renouvelés.', 70),
  ('Hors base', 'Toute question hors de cette base (prix précis d''une pièce, geste commercial, exception) doit être transmise à l''équipe.', 80)
) as v (title, content, position)
where not exists (select 1 from public.sav_knowledge_base);

-- ---------------------------------------------------------------------------
-- Anti-abus du chatbot
-- ---------------------------------------------------------------------------
create table if not exists public.sav_rate_limits (
  key text not null,
  window_start timestamptz not null,
  hits int not null default 0,
  primary key (key, window_start)
);

-- true si l'appel est autorisé (et le compte), false si la limite est atteinte.
create or replace function public.sav_rate_hit(p_key text, p_window interval, p_max int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start timestamptz := to_timestamp(floor(extract(epoch from now()) / extract(epoch from p_window)) * extract(epoch from p_window));
  v_hits int;
begin
  delete from public.sav_rate_limits where window_start < now() - interval '2 days';
  insert into public.sav_rate_limits as r (key, window_start, hits)
  values (p_key, v_start, 1)
  on conflict (key, window_start) do update set hits = r.hits + 1
  returning hits into v_hits;
  return v_hits <= p_max;
end;
$$;

-- ---------------------------------------------------------------------------
-- File d'emails
-- ---------------------------------------------------------------------------
create table if not exists public.sav_email_outbox (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid references public.sav_tickets (id) on delete cascade,
  message_id uuid references public.sav_ticket_messages (id) on delete cascade,
  kind text not null check (kind in ('ticket_created', 'team_reply', 'resolved', 'team_new_ticket')),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  claimed_at timestamptz,
  attempts int not null default 0,
  last_error text
);

create index if not exists sav_email_outbox_pending_idx on public.sav_email_outbox (created_at) where sent_at is null;

-- ---------------------------------------------------------------------------
-- RLS : équipe uniquement sur les tables ; service role (Edge Functions)
-- passe outre. Les clients passent par les vues ci-dessous.
-- ---------------------------------------------------------------------------
alter table public.sav_tickets enable row level security;
alter table public.sav_ticket_messages enable row level security;
alter table public.sav_ticket_events enable row level security;
alter table public.sav_chat_conversations enable row level security;
alter table public.sav_chat_messages enable row level security;
alter table public.sav_knowledge_base enable row level security;
alter table public.sav_rate_limits enable row level security;
alter table public.sav_email_outbox enable row level security;

drop policy if exists sav_tickets_admin_select on public.sav_tickets;
create policy sav_tickets_admin_select on public.sav_tickets for select using (public.is_admin());
drop policy if exists sav_ticket_messages_admin_select on public.sav_ticket_messages;
create policy sav_ticket_messages_admin_select on public.sav_ticket_messages for select using (public.is_admin());
drop policy if exists sav_ticket_events_admin_select on public.sav_ticket_events;
create policy sav_ticket_events_admin_select on public.sav_ticket_events for select using (public.is_admin());
drop policy if exists sav_chat_conversations_admin_select on public.sav_chat_conversations;
create policy sav_chat_conversations_admin_select on public.sav_chat_conversations for select using (public.is_admin());
drop policy if exists sav_chat_messages_admin_select on public.sav_chat_messages;
create policy sav_chat_messages_admin_select on public.sav_chat_messages for select using (public.is_admin());
drop policy if exists sav_knowledge_base_admin_all on public.sav_knowledge_base;
create policy sav_knowledge_base_admin_all on public.sav_knowledge_base
  for all using (public.is_admin()) with check (public.is_admin());

revoke all on function public.sav_rate_hit(text, interval, int) from public, anon, authenticated;
grant execute on function public.sav_rate_hit(text, interval, int) to service_role;

-- ---------------------------------------------------------------------------
-- Vues client (propriétaire = postgres : filtrent elles-mêmes sur le compte
-- connecté). Pas de champs litige, d'assignation ni de résumé IA interne.
-- ---------------------------------------------------------------------------
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
where t.reseller_id = public.current_reseller_id_incl_ended();

create or replace view public.sav_my_ticket_messages as
select m.id, m.ticket_id, m.author_type, m.content, m.attachments, m.created_at,
  case when m.author_type = 'team' then 'Équipe OZË' else coalesce(nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''), 'Vous') end as author_name
from public.sav_ticket_messages m
join public.sav_tickets t on t.id = m.ticket_id
left join public.profiles p on p.id = m.author_id
where not m.internal
  and t.reseller_id = public.current_reseller_id_incl_ended();

create or replace view public.sav_my_chat_messages as
select m.id, m.conversation_id, m.role, m.display_text, m.attachments, m.created_at
from public.sav_chat_messages m
join public.sav_chat_conversations c on c.id = m.conversation_id
where c.profile_id = auth.uid()
  and m.display_text <> '';

revoke all on public.sav_my_tickets, public.sav_my_ticket_messages, public.sav_my_chat_messages from public, anon;
grant select on public.sav_my_tickets, public.sav_my_ticket_messages, public.sav_my_chat_messages to authenticated;

-- ---------------------------------------------------------------------------
-- Stockage des photos : bucket privé, dossier = id du compte revendeur.
-- Le client dépose / lit dans son dossier ; l'équipe lit et dépose partout.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sav-attachments', 'sav-attachments', false, 8388608,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
on conflict (id) do update
set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists sav_attachments_client_insert on storage.objects;
create policy sav_attachments_client_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'sav-attachments'
    and (storage.foldername(name))[1] = public.current_reseller_id_incl_ended()::text
  );

drop policy if exists sav_attachments_client_select on storage.objects;
create policy sav_attachments_client_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'sav-attachments'
    and (storage.foldername(name))[1] = public.current_reseller_id_incl_ended()::text
  );

drop policy if exists sav_attachments_admin_all on storage.objects;
create policy sav_attachments_admin_all on storage.objects
  for all to authenticated
  using (bucket_id = 'sav-attachments' and public.is_admin())
  with check (bucket_id = 'sav-attachments' and public.is_admin());

notify pgrst, 'reload schema';
