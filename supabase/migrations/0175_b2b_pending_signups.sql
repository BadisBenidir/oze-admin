-- ============================================================================
-- Inscriptions Club B2B en attente de paiement (0167 modifié) : plus AUCUN
-- compte n'est créé avant le paiement. b2b-signup n'enregistre ici que les
-- informations saisies (mot de passe haché bcrypt, jamais en clair) et ouvre
-- la session Stripe ; le compte (auth, profil, revendeur abonné, contact)
-- n'est créé qu'une fois le paiement confirmé — par le webhook
-- (checkout.session.completed) ou par la page de remerciement si elle arrive
-- avant lui (b2b-signup, action "status"). Voir _shared/pendingSignup.ts.
--
-- Accès : service role uniquement en écriture ; lecture admin (tableau de
-- bord des abonnés : inscriptions non payées).
-- ============================================================================

create table if not exists public.b2b_pending_signups (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  first_name text not null,
  last_name text not null,
  phone text,
  billing_address text,
  billing_postal_code text,
  billing_city text,
  billing_country text,
  plan text not null check (plan in ('drops', 'revendeur')),
  password_hash text not null,
  cgv_version text,
  stripe_customer_id text,
  stripe_session_id text,
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed')),
  reseller_id uuid references public.resellers (id) on delete set null,
  profile_id uuid,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists b2b_pending_signups_email_idx on public.b2b_pending_signups (lower(email));
create index if not exists b2b_pending_signups_session_idx on public.b2b_pending_signups (stripe_session_id);

alter table public.b2b_pending_signups enable row level security;

drop policy if exists b2b_pending_signups_admin_select on public.b2b_pending_signups;
create policy b2b_pending_signups_admin_select on public.b2b_pending_signups
  for select using (public.is_admin());

-- Le hash du mot de passe ne sort jamais vers un client, même admin : aucun
-- droit sur la table, puis lecture accordée colonne par colonne (sans password_hash).
revoke all on public.b2b_pending_signups from anon, authenticated;
grant select (
  id, email, first_name, last_name, phone, billing_city, billing_country, plan,
  stripe_session_id, status, reseller_id, created_at, completed_at
) on public.b2b_pending_signups to authenticated;

notify pgrst, 'reload schema';
