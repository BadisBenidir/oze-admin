-- ============================================================================
-- Module B2B Revendeurs — 33 : codes promo
--
-- Système dédié au portail B2B, séparé de la table `coupons` (B2C, utilisée
-- par ozeparis.com) — flux de checkout, moteur de calcul et cible différents.
-- Un code est rattaché à un revendeur (pas un email) : un revendeur ne peut
-- utiliser un même code qu'une seule fois (contrainte unique sur
-- promo_code_uses), quel que soit le collègue de son équipe qui l'a saisi.
-- ============================================================================

create table if not exists public.promo_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  discount_type text not null check (discount_type in ('percentage', 'fixed_amount')),
  discount_value numeric not null check (discount_value > 0),
  min_order_amount numeric check (min_order_amount is null or min_order_amount >= 0),
  max_uses integer check (max_uses is null or max_uses > 0),
  uses_count integer not null default 0,
  valid_until timestamptz,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create index if not exists promo_codes_code_idx on public.promo_codes (code);

alter table public.promo_codes enable row level security;

drop policy if exists promo_codes_admin_all on public.promo_codes;
create policy promo_codes_admin_all on public.promo_codes
  for all using (public.is_admin()) with check (public.is_admin());

----------------------------------------------------------------------------
-- promo_code_uses : historique d'utilisation, une ligne par commande où un
-- code a effectivement été appliqué. La contrainte unique (promo_code_id,
-- reseller_id) est ce qui empêche un revendeur de réutiliser un même code.
----------------------------------------------------------------------------
create table if not exists public.promo_code_uses (
  id uuid primary key default gen_random_uuid(),
  promo_code_id uuid not null references public.promo_codes (id) on delete cascade,
  order_id uuid references public.orders (id) on delete set null,
  reseller_id uuid not null references public.resellers (id),
  profile_id uuid references public.profiles (id),
  discount_amount numeric not null,
  used_at timestamptz not null default now(),
  unique (promo_code_id, reseller_id)
);

alter table public.promo_code_uses enable row level security;

drop policy if exists promo_code_uses_admin_all on public.promo_code_uses;
create policy promo_code_uses_admin_all on public.promo_code_uses
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists promo_code_uses_reseller_select_own on public.promo_code_uses;
create policy promo_code_uses_reseller_select_own on public.promo_code_uses
  for select using (reseller_id = public.current_reseller_id());

----------------------------------------------------------------------------
-- orders : traçabilité du code appliqué + montant réellement déduit.
----------------------------------------------------------------------------
alter table public.orders add column if not exists promo_code_id uuid references public.promo_codes (id);
alter table public.orders add column if not exists promo_code text;
alter table public.orders add column if not exists promo_discount_amount numeric not null default 0;

----------------------------------------------------------------------------
-- validate_promo_code : vérification temps réel (bouton "Appliquer" côté
-- panier). SECURITY DEFINER pour lire promo_codes malgré le RLS admin-only
-- ci-dessus, mais ne renvoie jamais la liste des codes — seulement le
-- résultat pour LE code demandé. p_subtotal doit être le sous-total réel du
-- panier (revalidé de toute façon côté b2b-checkout avant tout paiement).
----------------------------------------------------------------------------
create or replace function public.validate_promo_code(p_code text, p_subtotal numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reseller_id uuid;
  v_code record;
  v_discount numeric;
begin
  v_reseller_id := public.current_reseller_id();
  if v_reseller_id is null then
    return jsonb_build_object('valid', false, 'error', 'Aucun compte revendeur actif associé à ce compte');
  end if;

  select * into v_code from public.promo_codes where code = upper(trim(p_code));
  if not found then
    return jsonb_build_object('valid', false, 'error', 'Code promo introuvable');
  end if;
  if v_code.status <> 'active' then
    return jsonb_build_object('valid', false, 'error', 'Ce code promo est désactivé');
  end if;
  if v_code.valid_until is not null and v_code.valid_until <= now() then
    return jsonb_build_object('valid', false, 'error', 'Ce code promo a expiré');
  end if;
  if v_code.max_uses is not null and v_code.uses_count >= v_code.max_uses then
    return jsonb_build_object('valid', false, 'error', 'Ce code promo a atteint son nombre maximal d''utilisations');
  end if;
  if v_code.min_order_amount is not null and p_subtotal < v_code.min_order_amount then
    return jsonb_build_object('valid', false, 'error', 'Montant minimum d''achat non atteint (' || v_code.min_order_amount || ' € requis)');
  end if;
  if exists (
    select 1 from public.promo_code_uses
    where promo_code_id = v_code.id and reseller_id = v_reseller_id
  ) then
    return jsonb_build_object('valid', false, 'error', 'Vous avez déjà utilisé ce code promo');
  end if;

  if v_code.discount_type = 'percentage' then
    v_discount := round(p_subtotal * v_code.discount_value / 100, 2);
  else
    v_discount := least(v_code.discount_value, p_subtotal);
  end if;

  return jsonb_build_object(
    'valid', true,
    'code', v_code.code,
    'promo_code_id', v_code.id,
    'discount_amount', v_discount
  );
end;
$$;

grant execute on function public.validate_promo_code(text, numeric) to authenticated;

----------------------------------------------------------------------------
-- record_promo_code_use : appelée uniquement par le webhook Stripe (service
-- role) après confirmation du paiement — jamais depuis le client. Réutilise
-- la contrainte unique de promo_code_uses pour empêcher toute double
-- utilisation en cas de course entre deux paiements simultanés ; met à jour
-- orders.total_amount en conséquence puisque confirm_b2b_payment ne connaît
-- pas encore le code promo au moment où il crée la commande.
----------------------------------------------------------------------------
create or replace function public.record_promo_code_use(
  p_promo_code_id uuid,
  p_order_id uuid,
  p_reseller_id uuid,
  p_profile_id uuid,
  p_discount_amount numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code record;
begin
  select * into v_code from public.promo_codes where id = p_promo_code_id for update;
  if not found then
    return jsonb_build_object('applied', false, 'reason', 'code_not_found');
  end if;
  if v_code.status <> 'active' then
    return jsonb_build_object('applied', false, 'reason', 'inactive');
  end if;
  if v_code.valid_until is not null and v_code.valid_until <= now() then
    return jsonb_build_object('applied', false, 'reason', 'expired');
  end if;
  if v_code.max_uses is not null and v_code.uses_count >= v_code.max_uses then
    return jsonb_build_object('applied', false, 'reason', 'max_uses_reached');
  end if;

  begin
    insert into public.promo_code_uses (promo_code_id, order_id, reseller_id, profile_id, discount_amount)
    values (p_promo_code_id, p_order_id, p_reseller_id, p_profile_id, p_discount_amount);
  exception when unique_violation then
    return jsonb_build_object('applied', false, 'reason', 'already_used');
  end;

  update public.promo_codes set uses_count = uses_count + 1 where id = p_promo_code_id;

  update public.orders
  set promo_code_id = p_promo_code_id,
      promo_code = v_code.code,
      promo_discount_amount = p_discount_amount,
      total_amount = total_amount - p_discount_amount
  where id = p_order_id;

  return jsonb_build_object('applied', true);
end;
$$;

revoke all on function public.record_promo_code_use(uuid, uuid, uuid, uuid, numeric) from public, anon, authenticated;

notify pgrst, 'reload schema';
