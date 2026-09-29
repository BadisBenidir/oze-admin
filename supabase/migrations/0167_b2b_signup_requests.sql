-- ============================================================================
-- Demandes d'adhésion au Club B2B depuis la landing publique pro.ozeparis.com.
--
-- Parcours : landing → /inscription?pass=... (formulaire, visiteur non
-- connecté) → insertion ici → redirection vers le Stripe Payment Link du pass,
-- avec client_reference_id = id de la demande et prefilled_email. Le paiement
-- Stripe se rapproche donc de la demande par cet id.
--
-- Aucun compte n'est créé automatiquement : l'admin crée le revendeur (et son
-- compte principal) à partir de la demande, via le formulaire existant.
--
-- Sécurité : le visiteur anonyme peut seulement INSÉRER une demande en statut
-- 'pending' ; il ne peut ni relire, ni modifier, ni supprimer (l'id est généré
-- côté client, donc pas besoin de RETURNING / SELECT). Lecture et mise à jour
-- réservées aux admins.
-- ============================================================================

create table if not exists public.b2b_signup_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  plan text not null check (plan in ('drops', 'revendeur')),
  company_name text not null check (length(trim(company_name)) between 1 and 200),
  legal_id text not null check (length(trim(legal_id)) between 1 and 50),
  first_name text not null check (length(trim(first_name)) between 1 and 100),
  last_name text not null check (length(trim(last_name)) between 1 and 100),
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(email) <= 254),
  phone text not null check (length(trim(phone)) between 6 and 30),
  address text not null check (length(trim(address)) between 1 and 300),
  postal_code text not null check (length(trim(postal_code)) between 1 and 20),
  city text not null check (length(trim(city)) between 1 and 100),
  country text not null check (length(trim(country)) between 1 and 60),
  terms_accepted_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'paid', 'account_created', 'cancelled')),
  reseller_id uuid references public.resellers(id) on delete set null,
  admin_notes text
);

create index if not exists b2b_signup_requests_created_at_idx
  on public.b2b_signup_requests (created_at desc);
create index if not exists b2b_signup_requests_status_idx
  on public.b2b_signup_requests (status);

alter table public.b2b_signup_requests enable row level security;

-- Visiteur (anon) ou connecté : insertion d'une nouvelle demande uniquement,
-- sans pouvoir forcer un statut, un rattachement revendeur ou des notes.
drop policy if exists "b2b_signup_requests_public_insert" on public.b2b_signup_requests;
create policy "b2b_signup_requests_public_insert"
  on public.b2b_signup_requests
  for insert
  to anon, authenticated
  with check (
    status = 'pending'
    and reseller_id is null
    and admin_notes is null
    and terms_accepted_at <= now() + interval '5 minutes'
  );

drop policy if exists "b2b_signup_requests_admin_select" on public.b2b_signup_requests;
create policy "b2b_signup_requests_admin_select"
  on public.b2b_signup_requests
  for select
  to authenticated
  using (public.is_admin());

drop policy if exists "b2b_signup_requests_admin_update" on public.b2b_signup_requests;
create policy "b2b_signup_requests_admin_update"
  on public.b2b_signup_requests
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant insert on public.b2b_signup_requests to anon, authenticated;
grant select, update on public.b2b_signup_requests to authenticated;
