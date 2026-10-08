-- ============================================================================
-- Codes promo des abonnements Club B2B, gérés dans l'admin (« Codes promo
-- Club ») et non plus dans Stripe.
--
-- Saisis sur la page d'inscription, vérifiés par b2b-signup contre cette
-- table. Au paiement, la remise est transmise à Stripe sous la forme d'un
-- coupon créé automatiquement (id déterministe dérivé des conditions du
-- code : modifier la remise crée un nouveau coupon, les abonnés déjà inscrits
-- gardent la leur). Le suivi (membres, CA) se fait sur
-- b2b_subscription_payments.promo_code (0191) = code saisi.
-- ============================================================================

create table if not exists public.club_promo_codes (
  id uuid primary key default gen_random_uuid(),
  -- Toujours en majuscules (comparaison exacte côté b2b-signup).
  code text not null check (code = upper(code) and code ~ '^[A-Z0-9_-]{3,30}$'),
  discount_type text not null check (discount_type in ('percentage', 'fixed_amount')),
  discount_value numeric(10, 2) not null check (discount_value > 0),
  -- once = premier mois ; repeating = pendant duration_months mois ; forever = à vie.
  duration text not null default 'once' check (duration in ('once', 'repeating', 'forever')),
  duration_months int check (duration_months is null or duration_months between 1 and 36),
  plans text[] not null default array['drops', 'revendeur'],
  max_uses int check (max_uses is null or max_uses > 0),
  valid_until timestamptz,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint club_promo_codes_percentage_max check (discount_type <> 'percentage' or discount_value <= 100),
  constraint club_promo_codes_repeating_months check (duration <> 'repeating' or duration_months is not null)
);

create unique index if not exists club_promo_codes_code_key on public.club_promo_codes (upper(code));

alter table public.club_promo_codes enable row level security;

drop policy if exists club_promo_codes_admin_all on public.club_promo_codes;
create policy club_promo_codes_admin_all on public.club_promo_codes
  for all using (public.is_admin()) with check (public.is_admin());

notify pgrst, 'reload schema';
