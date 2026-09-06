-- ============================================================================
-- Le statut juridique (0109) devient définitif une fois choisi : un
-- revendeur ne peut plus le changer lui-même après la première validation
-- (empêche un contournement du type "je me déclare Particulier pour éviter
-- telle contrainte, puis je repasse en Société plus tard"). Seul un admin
-- OZË garde la main pour corriger une erreur de saisie, via l'édition
-- directe de `resellers` (ResellerFormModal.tsx / useResellers.ts,
-- resellers_admin_all, jamais concernée par cette RPC).
-- ============================================================================

create or replace function public.set_reseller_legal_info(
  p_legal_status text,
  p_company_name text,
  p_siret text,
  p_vat_number text,
  p_legal_form text,
  p_address text,
  p_city text,
  p_postal_code text,
  p_country text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reseller_id uuid := public.current_reseller_id();
  v_current_status text;
  v_siret text := nullif(trim(coalesce(p_siret, '')), '');
  v_vat text := nullif(trim(coalesce(p_vat_number, '')), '');
  v_legal_form text := nullif(trim(coalesce(p_legal_form, '')), '');
  v_company_name text := nullif(trim(coalesce(p_company_name, '')), '');
begin
  if v_reseller_id is null then
    raise exception 'Aucun compte revendeur actif associé à cet utilisateur';
  end if;

  select legal_status into v_current_status from public.resellers where id = v_reseller_id;
  if v_current_status is not null then
    raise exception 'Le statut juridique a déjà été défini et ne peut plus être modifié. Contactez votre administrateur OZË Paris pour le corriger.';
  end if;

  if p_legal_status not in ('individual', 'sole_proprietorship', 'company') then
    raise exception 'Statut juridique invalide';
  end if;

  if p_legal_status in ('sole_proprietorship', 'company') then
    if v_company_name is null then
      raise exception 'La dénomination est obligatoire pour ce statut';
    end if;
    if v_siret is null or v_siret !~ '^[0-9]{14}$' then
      raise exception 'Le numéro SIRET doit comporter exactement 14 chiffres';
    end if;
  end if;

  if p_legal_status = 'company' and v_legal_form is null then
    raise exception 'La forme juridique est obligatoire pour une société';
  end if;

  update public.resellers
  set legal_status = p_legal_status,
      company_name = coalesce(v_company_name, company_name),
      siret = case when p_legal_status = 'individual' then null else v_siret end,
      vat_number = case when p_legal_status = 'individual' then null else v_vat end,
      legal_form = case when p_legal_status = 'company' then v_legal_form else null end,
      address = coalesce(nullif(trim(coalesce(p_address, '')), ''), address),
      city = coalesce(nullif(trim(coalesce(p_city, '')), ''), city),
      postal_code = coalesce(nullif(trim(coalesce(p_postal_code, '')), ''), postal_code),
      country = coalesce(nullif(trim(coalesce(p_country, '')), ''), country)
  where id = v_reseller_id;

  return jsonb_build_object('success', true);
end;
$$;

grant execute on function public.set_reseller_legal_info(text, text, text, text, text, text, text, text, text) to authenticated;

notify pgrst, 'reload schema';
