-- ============================================================================
-- Suivi de trafic du portail B2B (onglet admin "Statistiques B2B") :
--   1. Présence temps réel — géré entièrement côté client via un canal
--      Supabase Realtime Presence ('online-b2b-users', voir
--      useResellerPresenceTracking.ts / useB2BTraffic.ts), rien à stocker en
--      base pour ça — la présence est par nature éphémère (in-memory côté
--      Realtime, jamais persistée).
--   2. Visiteurs uniques par jour — seule partie qui a besoin de
--      persistance, ci-dessous : une ligne par (profil, jour).
--
-- FK vers profiles(id), PAS resellers(id) : convention unique de ce schéma
-- (profiles.id = auth.uid() partout) — "visiteur unique" se compte par
-- sous-compte connecté, pas par entreprise (deux collègues de la même
-- société qui se connectent le même jour comptent pour 2 visiteurs, pas 1).
-- ============================================================================

create table if not exists public.reseller_daily_sessions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  date date not null default current_date,
  created_at timestamptz not null default now(),
  unique (profile_id, date)
);

create index if not exists reseller_daily_sessions_date_idx on public.reseller_daily_sessions (date);

comment on table public.reseller_daily_sessions is
  'Une ligne par (sous-compte revendeur, jour) — posée une fois par session côté portail B2B (voir useResellerPresenceTracking.ts), idempotente grâce à la contrainte unique (upsert ignoreDuplicates, jamais de vrai debounce nécessaire).';

alter table public.reseller_daily_sessions enable row level security;

-- Admin : lecture complète (agrégats du dashboard "Statistiques B2B").
drop policy if exists reseller_daily_sessions_admin_select on public.reseller_daily_sessions;
create policy reseller_daily_sessions_admin_select on public.reseller_daily_sessions
  for select using (public.is_admin());

-- Revendeur : peut seulement créer SA PROPRE ligne du jour — jamais lire ni
-- modifier celle d'un autre sous-compte (même isolation que legal_status/
-- siret depuis 0109).
drop policy if exists reseller_daily_sessions_self_insert on public.reseller_daily_sessions;
create policy reseller_daily_sessions_self_insert on public.reseller_daily_sessions
  for insert with check (profile_id = auth.uid());

revoke all on public.reseller_daily_sessions from public, authenticated;
grant select on public.reseller_daily_sessions to authenticated;
grant insert on public.reseller_daily_sessions to authenticated;

notify pgrst, 'reload schema';
