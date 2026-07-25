-- ============================================================================
-- Module B2B Revendeurs — 46 : passe l'exclusivité des codes promo "usage
-- général" d'une limite PAR ENTREPRISE à une limite PAR PERSONNE.
--
-- Jusqu'ici, promo_code_uses avait unique (promo_code_id, reseller_id) : un
-- code ne pouvait être utilisé qu'une fois par ENTREPRISE, peu importe quel
-- contact de l'équipe le saisissait. Confirmé (voir incident du 2026-07-25)
-- que ce n'était pas un bug — la fonction déployée correspondait exactement
-- à la migration 0034 — mais un comportement que l'admin veut maintenant
-- changer : chaque sous-compte individuel doit pouvoir utiliser un code
-- "usage général" une fois, même si un collègue de la même société l'a déjà
-- fait.
--
-- record_promo_code_use n'a besoin d'AUCUNE modification : elle s'appuie
-- déjà uniquement sur la violation de la contrainte unique (exception
-- unique_violation) pour détecter une réutilisation, jamais sur une
-- vérification explicite de reseller_id — changer la contrainte suffit.
-- Seule validate_promo_code (la vérification "temps réel" côté panier) a une
-- vérification explicite à adapter.
--
-- Le mode "Usage unique global" (is_single_use) n'est pas concerné : sa
-- règle porte sur uses_count global, pas sur cette contrainte.
-- ============================================================================

alter table public.promo_code_uses drop constraint if exists promo_code_uses_promo_code_id_reseller_id_key;
alter table public.promo_code_uses add constraint promo_code_uses_promo_code_id_profile_id_key unique (promo_code_id, profile_id);

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
  -- Exclusivité PAR PERSONNE (auth.uid()), plus par entreprise : un collègue
  -- du même revendeur peut désormais utiliser le même code "usage général".
  if exists (
    select 1 from public.promo_code_uses
    where promo_code_id = v_code.id and profile_id = auth.uid()
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

notify pgrst, 'reload schema';
