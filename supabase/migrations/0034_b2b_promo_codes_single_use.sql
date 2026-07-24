-- ============================================================================
-- Module B2B Revendeurs — 34 : règle d'exclusivité des codes promo
--
-- Ajoute un mode "usage unique global" (premier arrivé, premier servi) : dès
-- qu'UN revendeur l'utilise, le code devient invalide pour tout le monde,
-- indépendamment de max_uses (qui reste utilisable en mode "usage général"
-- pour plafonner le nombre total d'utilisations distinctes).
-- ============================================================================

alter table public.promo_codes add column if not exists is_single_use boolean not null default false;

----------------------------------------------------------------------------
-- validate_promo_code : ajoute la vérification usage unique global, avant
-- la vérification max_uses (qui reste pertinente en mode "usage général").
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
  if v_code.is_single_use and v_code.uses_count >= 1 then
    return jsonb_build_object('valid', false, 'error', 'Ce code promo à usage unique a déjà été utilisé');
  end if;
  if not v_code.is_single_use and v_code.max_uses is not null and v_code.uses_count >= v_code.max_uses then
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
-- record_promo_code_use : même règle, revérifiée de façon atomique (row lock
-- déjà posé via "for update") au moment de la confirmation de paiement —
-- c'est ce qui tranche en cas de deux paiements simultanés sur un code à
-- usage unique.
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
  if v_code.is_single_use and v_code.uses_count >= 1 then
    return jsonb_build_object('applied', false, 'reason', 'single_use_exhausted');
  end if;
  if not v_code.is_single_use and v_code.max_uses is not null and v_code.uses_count >= v_code.max_uses then
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
