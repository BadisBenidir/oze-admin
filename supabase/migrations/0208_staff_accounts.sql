-- ============================================================================
-- Comptes employés de l'admin (profiles.role = 'staff').
--
-- Le propriétaire (role 'admin') crée un compte employé depuis l'admin
-- (Équipe → Employés, fonction manage-staff) et choisit :
--   - pages      : les pages de l'admin visibles (ids 'onglet:sous-onglet',
--                  ex. 'orders:b2b', 'b2b:sourcing') ;
--   - actions    : les actions sensibles autorisées —
--                  'wallet'    ajuster les soldes des membres,
--                  'refunds'   annuler / rembourser (commandes, lots,
--                              articles, demandes de livraison, Entrupy),
--                  'invoicing' facturation Qonto,
--                  'accounts'  gérer les comptes membres (inviter,
--                              désactiver, mots de passe, emails) ;
--   - show_figures : voir les chiffres (CA, prix d'achat, marges) — sinon
--                  « Masquer les chiffres » est imposé ;
--   - active     : accès ouvert ou suspendu.
--
-- Sécurité : un employé actif passe public.is_admin() (accès aux données
-- de l'admin, nécessaire aux pages), mais les actions sensibles qui ne lui
-- sont pas données sont refusées côté serveur (public.admin_can(action) dans
-- les RPC, hasAdminAccess dans les fonctions Edge). La gestion de l'équipe
-- reste réservée au propriétaire (public.is_owner()).
-- ============================================================================

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check check (role in ('admin', 'client', 'reseller', 'staff'));

create table if not exists public.staff_permissions (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  pages text[] not null default '{}',
  actions text[] not null default '{}',
  show_figures boolean not null default false,
  active boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.is_owner()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;
grant execute on function public.is_owner() to authenticated;

-- Propriétaire, ou employé actif.
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    left join public.staff_permissions s on s.profile_id = p.id
    where p.id = auth.uid()
      and (p.role = 'admin' or (p.role = 'staff' and coalesce(s.active, false)))
  );
$$;
grant execute on function public.is_admin() to authenticated;

-- Action sensible autorisée ? (propriétaire : toujours)
create or replace function public.admin_can(p_action text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    left join public.staff_permissions s on s.profile_id = p.id
    where p.id = auth.uid()
      and (
        p.role = 'admin'
        or (p.role = 'staff' and coalesce(s.active, false) and p_action = any(s.actions))
      )
  );
$$;
grant execute on function public.admin_can(text) to authenticated;

alter table public.staff_permissions enable row level security;

drop policy if exists staff_permissions_owner_all on public.staff_permissions;
create policy staff_permissions_owner_all on public.staff_permissions
  for all using (public.is_owner()) with check (public.is_owner());

drop policy if exists staff_permissions_select_own on public.staff_permissions;
create policy staff_permissions_select_own on public.staff_permissions
  for select using (profile_id = auth.uid());

-- ----------------------------------------------------------------------------
-- FAILLE CORRIGÉE : la policy profiles_update_own_non_critical laisse tout
-- utilisateur modifier SA ligne, et le rôle authenticated a le droit UPDATE
-- sur toutes les colonnes — dont role et wallet_balance. Un membre pouvait
-- donc, via l'API, se donner le rôle admin ou se créditer un solde. Ce
-- trigger (non SECURITY DEFINER : current_user = 'authenticated' pour une
-- requête API, le propriétaire des fonctions pour les RPC SECURITY DEFINER
-- légitimes — paiement par solde, recharges…) refuse depuis l'API :
--   - tout changement de rôle, et toute création de profil admin / staff
--     (les comptes employés passent par manage-staff, en service role) ;
--   - pour un non-admin, toute modification du solde, de la fidélité et des
--     champs d'activation / facturation.
-- ----------------------------------------------------------------------------
create or replace function public.protect_profile_privileged_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.role in ('admin', 'staff') then
      raise exception 'Création de ce type de compte non autorisée';
    end if;
    return new;
  end if;

  if new.role is distinct from old.role then
    raise exception 'Modification du rôle non autorisée';
  end if;

  if not public.is_admin() and (
    new.wallet_balance is distinct from old.wallet_balance
    or new.loyalty_gifts_unlocked is distinct from old.loyalty_gifts_unlocked
    or new.loyalty_progress_checkpoint is distinct from old.loyalty_progress_checkpoint
    or new.activated_at is distinct from old.activated_at
    or new.last_invited_at is distinct from old.last_invited_at
    or new.qonto_client_id is distinct from old.qonto_client_id
  ) then
    raise exception 'Modification non autorisée';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_protect_privileged_columns on public.profiles;
create trigger profiles_protect_privileged_columns
before insert or update on public.profiles
for each row execute function public.protect_profile_privileged_columns();

-- Ajustement manuel de solde (dernière version : 0036) : action 'wallet'.
create or replace function public.admin_adjust_wallet_balance(
  p_profile_id uuid,
  p_amount numeric,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reseller_id uuid;
  v_balance numeric;
  v_tx_id uuid;
begin
  if not public.admin_can('wallet') then
    raise exception 'Action non autorisée : ajuster les soldes';
  end if;
  if p_amount = 0 then
    raise exception 'Le montant de l''ajustement ne peut pas être nul';
  end if;
  if p_note is null or trim(p_note) = '' then
    raise exception 'Une note explicative est requise pour tout ajustement manuel';
  end if;

  select wallet_balance into v_balance from public.profiles where id = p_profile_id for update;
  if v_balance is null then
    raise exception 'Profil introuvable';
  end if;
  if v_balance + p_amount < 0 then
    raise exception 'Le retrait dépasse le solde disponible (% €)', v_balance;
  end if;

  select rc.reseller_id into v_reseller_id from public.reseller_contacts rc where rc.profile_id = p_profile_id;
  if v_reseller_id is null then
    raise exception 'Ce profil n''est rattaché à aucune société revendeuse';
  end if;

  update public.profiles set wallet_balance = wallet_balance + p_amount where id = p_profile_id;

  insert into public.wallet_transactions (profile_id, reseller_id, amount, type, status, note, created_by)
  values (p_profile_id, v_reseller_id, p_amount, 'ajustement_admin', 'success', p_note, auth.uid())
  returning id into v_tx_id;

  return jsonb_build_object('transaction_id', v_tx_id, 'new_balance', v_balance + p_amount);
end;
$$;
revoke all on function public.admin_adjust_wallet_balance(uuid, numeric, text) from public;
grant execute on function public.admin_adjust_wallet_balance(uuid, numeric, text) to authenticated;

notify pgrst, 'reload schema';
