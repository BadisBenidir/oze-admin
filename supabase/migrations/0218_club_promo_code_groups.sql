-- ============================================================================
-- Groupes de codes promo Club (page « Codes promo Club »).
--
-- Un groupe a un titre et les conditions d'une remise (type, montant, durée,
-- pass, date limite, partenaire). L'admin y génère autant de codes
-- individuels qu'il veut, à donner chacun à une personne : ce sont des lignes
-- club_promo_codes ordinaires (group_id renseigné) qui reprennent les
-- conditions du groupe — la validation à l'inscription (subscriptionPromo.ts)
-- ne change donc pas. Modifier / désactiver le groupe s'applique à ses codes.
-- ============================================================================

create table if not exists public.club_promo_code_groups (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  discount_type text not null check (discount_type in ('percentage', 'fixed_amount')),
  discount_value numeric(10, 2) not null check (discount_value > 0),
  duration text not null check (duration in ('once', 'repeating', 'forever')),
  duration_months integer,
  plans text[] not null default array['drops', 'revendeur'],
  uses_per_code integer default 1,
  valid_until timestamptz,
  status text not null default 'active' check (status in ('active', 'inactive')),
  partner_name text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.club_promo_code_groups enable row level security;

drop policy if exists club_promo_code_groups_admin_all on public.club_promo_code_groups;
create policy club_promo_code_groups_admin_all on public.club_promo_code_groups
  for all using (public.is_admin()) with check (public.is_admin());

alter table public.club_promo_codes add column if not exists group_id uuid
  references public.club_promo_code_groups (id) on delete cascade;

create index if not exists club_promo_codes_group_idx on public.club_promo_codes (group_id) where group_id is not null;

notify pgrst, 'reload schema';
