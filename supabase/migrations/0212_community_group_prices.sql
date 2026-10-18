-- ============================================================================
-- Prix d'abonnement des membres d'une communauté partenaire, par groupe
-- d'accès (0211).
--
-- L'admin programme, pour une entreprise (ex. Aurel Vinted), le prix mensuel
-- de chaque groupe à partir d'une date : une ligne par changement (historique
-- conservé). Prix en vigueur d'un groupe = dernière ligne dont effective_from
-- est passée ; changement à venir = première ligne future.
--   - le contact principal voit le prix à côté du groupe de chaque membre ;
--   - chaque membre est prévenu à la connexion du prix à venir de son groupe.
-- Ne déclenche encore aucun prélèvement (étape suivante : abonnement Stripe).
-- ============================================================================

create table if not exists public.community_group_prices (
  id uuid primary key default gen_random_uuid(),
  reseller_id uuid not null references public.resellers (id) on delete cascade,
  member_group smallint not null check (member_group between 1 and 4),
  monthly_price numeric(10, 2) not null check (monthly_price >= 0),
  effective_from date not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (reseller_id, member_group, effective_from)
);

create index if not exists community_group_prices_lookup_idx
  on public.community_group_prices (reseller_id, member_group, effective_from desc);

alter table public.community_group_prices enable row level security;

drop policy if exists community_group_prices_admin_all on public.community_group_prices;
create policy community_group_prices_admin_all on public.community_group_prices
  for all using (public.is_admin()) with check (public.is_admin());

-- Les membres d'une entreprise lisent les prix de leur entreprise.
drop policy if exists community_group_prices_member_select on public.community_group_prices;
create policy community_group_prices_member_select on public.community_group_prices
  for select using (reseller_id = public.current_reseller_id());

notify pgrst, 'reload schema';
