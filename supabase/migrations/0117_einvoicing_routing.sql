-- ============================================================================
-- Verrouillage du profil légal (champs stricts Factur-X/PDP) et routage de
-- facturation électronique B2B/B2C.
--
-- Le "verrouillage" (une fois legal_status défini, plus modifiable par le
-- revendeur lui-même) existe déjà depuis 0109 — cette migration renforce la
-- VALIDATION des champs pour préparer la conformité Factur-X (SIRET,
-- TVA intracommunautaire au format FR+11, pays en ISO 3166-1 alpha-2) et
-- introduit le "routage" : chaque facture porte désormais son type
-- (b2b_facturx / b2c_retail) et un statut de transmission, calculés
-- automatiquement selon legal_status au moment de la génération.
--
-- Important — ce qui n'est PAS fait ici (voir le message accompagnant cette
-- migration) : aucun appel réel à une API Qonto de facturation électronique,
-- aucune génération de XML Factur-X (format hybride PDF/A-3 + XML CII selon
-- EN16931) ni transmission à une vraie PDP. Le PDF reste généré par jsPDF
-- (generateInvoicePdf.ts) pour les deux branches ; `invoice_type` est une
-- métadonnée de routage prête à être branchée sur une vraie intégration une
-- fois le contrat/l'API Qonto réellement vérifiés.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. invoices : type de facture + statut de transmission (badges admin).
-- ----------------------------------------------------------------------------
alter table public.invoices
  add column if not exists invoice_type text not null default 'b2c_retail' check (invoice_type in ('b2b_facturx', 'b2c_retail')),
  add column if not exists transmission_status text not null default 'not_applicable' check (transmission_status in ('not_applicable', 'pending', 'sent', 'failed'));

comment on column public.invoices.invoice_type is
  'b2b_facturx = acheteur professionnel (EI/société), destiné à terme à une transmission Factur-X/PDP ; b2c_retail = particulier, facture standard pour le registre e-reporting.';
comment on column public.invoices.transmission_status is
  'Toujours ''not_applicable'' tant qu''aucune vraie intégration PDP n''est branchée (voir 0117) — champ prêt pour un futur statut réel (pending/sent/failed).';

-- ----------------------------------------------------------------------------
-- 2. Normalisation du pays en ISO 3166-1 alpha-2 sur le PDF de facture,
-- sans toucher aux données stockées ni aux formulaires d'adresse existants
-- (autocomplete d'adresse personnelle, select d'adresse légale) : mappe les
-- valeurs déjà en base ("France", "Belgique"...) vers un code ISO au moment
-- de figer billing_details, retourne la valeur telle quelle si déjà un code
-- ISO ou inconnue (ne doit jamais faire échouer une génération de facture).
-- ----------------------------------------------------------------------------
create or replace function public.country_name_to_iso(p_country text)
returns text
language sql
immutable
as $$
  select case lower(trim(coalesce(p_country, '')))
    when 'france' then 'FR'
    when 'fr' then 'FR'
    when 'belgique' then 'BE'
    when 'be' then 'BE'
    when 'suisse' then 'CH'
    when 'ch' then 'CH'
    when 'luxembourg' then 'LU'
    when 'lu' then 'LU'
    when 'monaco' then 'MC'
    when 'mc' then 'MC'
    else coalesce(nullif(trim(p_country), ''), 'FR')
  end;
$$;

-- ----------------------------------------------------------------------------
-- 3. set_reseller_legal_info : renforce la validation (TVA intraco au format
-- FR+11 quand fournie, quel que soit le statut) et calcule automatiquement
-- le nom officiel d'une EI depuis le prénom/nom déjà connus du profil
-- ("Prénom Nom EI") plutôt que de faire ressaisir une dénomination libre à
-- l'utilisateur — conserve la signature existante (p_legal_entity_name
-- reste accepté mais ignoré pour 'sole_proprietorship') pour ne pas casser
-- l'appel déjà déployé côté client.
-- ----------------------------------------------------------------------------
create or replace function public.set_reseller_legal_info(
  p_legal_status text,
  p_legal_entity_name text,
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
  v_user_id uuid := auth.uid();
  v_current_status text;
  v_first_name text;
  v_last_name text;
  v_siret text := nullif(trim(coalesce(p_siret, '')), '');
  v_vat text := nullif(trim(coalesce(upper(p_vat_number), '')), '');
  v_legal_form text := nullif(trim(coalesce(p_legal_form, '')), '');
  v_entity_name text := nullif(trim(coalesce(p_legal_entity_name, '')), '');
begin
  if v_user_id is null or public.current_reseller_id() is null then
    raise exception 'Aucun compte revendeur actif associé à cet utilisateur';
  end if;

  select legal_status, first_name, last_name into v_current_status, v_first_name, v_last_name
  from public.profiles where id = v_user_id;

  if v_current_status is not null then
    raise exception 'Le statut juridique a déjà été défini et ne peut plus être modifié. Contactez votre administrateur OZË Paris pour le corriger.';
  end if;

  if p_legal_status not in ('individual', 'sole_proprietorship', 'company') then
    raise exception 'Statut juridique invalide';
  end if;

  -- EI : dénomination toujours dérivée de l'identité civile déjà connue,
  -- jamais d'une saisie libre (évite un nom officiel fantaisiste sur une
  -- facture légale).
  if p_legal_status = 'sole_proprietorship' then
    v_entity_name := trim(coalesce(v_first_name, '') || ' ' || coalesce(v_last_name, '')) || ' EI';
  end if;

  if p_legal_status in ('sole_proprietorship', 'company') then
    if v_entity_name is null or v_entity_name = 'EI' then
      raise exception 'Impossible de déterminer votre dénomination : votre prénom et nom doivent être renseignés au préalable';
    end if;
    if v_siret is null or v_siret !~ '^[0-9]{14}$' then
      raise exception 'Le numéro SIRET doit comporter exactement 14 chiffres';
    end if;
  end if;

  if p_legal_status = 'company' and v_legal_form is null then
    raise exception 'La forme juridique est obligatoire pour une société';
  end if;

  -- N° de TVA intracommunautaire : facultatif (franchise en base, art. 293 B
  -- du CGI) mais son FORMAT doit être valide dès lors qu'il est renseigné,
  -- quel que soit le statut pro (EI ou société).
  if v_vat is not null and v_vat !~ '^FR[0-9A-Z]{11}$' then
    raise exception 'Le numéro de TVA intracommunautaire doit être au format FR suivi de 11 caractères (ex: FR12345678901)';
  end if;

  update public.profiles
  set legal_status = p_legal_status,
      legal_entity_name = case when p_legal_status = 'individual' then null else v_entity_name end,
      siret = case when p_legal_status = 'individual' then null else v_siret end,
      vat_number = case when p_legal_status = 'individual' then null else v_vat end,
      legal_form = case when p_legal_status = 'company' then v_legal_form else null end,
      legal_address = case when p_legal_status = 'individual' then null else nullif(trim(coalesce(p_address, '')), '') end,
      legal_city = case when p_legal_status = 'individual' then null else nullif(trim(coalesce(p_city, '')), '') end,
      legal_postal_code = case when p_legal_status = 'individual' then null else nullif(trim(coalesce(p_postal_code, '')), '') end,
      legal_country = case when p_legal_status = 'individual' then null else coalesce(public.country_name_to_iso(p_country), 'FR') end
  where id = v_user_id;

  return jsonb_build_object('success', true);
end;
$$;

grant execute on function public.set_reseller_legal_info(text, text, text, text, text, text, text, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. generate_invoice_for_order : fixe invoice_type/transmission_status et
-- normalise le pays en ISO dans billing_details (voir country_name_to_iso).
-- ----------------------------------------------------------------------------
create or replace function public.generate_invoice_for_order(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_profile record;
  v_existing_id uuid;
  v_billing jsonb;
  v_year int;
  v_next_number int;
  v_invoice_number text;
  v_invoice_id uuid;
  v_invoice_type text;
begin
  select * into v_order from public.orders where id = p_order_id;
  if v_order is null then
    raise exception 'Commande introuvable';
  end if;

  if not (
    public.is_admin()
    or v_order.placed_by_profile_id = auth.uid()
    or v_order.email = (select email from public.profiles where id = auth.uid())
  ) then
    raise exception 'Accès refusé à cette commande';
  end if;

  select id into v_existing_id from public.invoices where order_id = p_order_id;
  if v_existing_id is not null then
    return jsonb_build_object('already_generated', true, 'invoice_id', v_existing_id);
  end if;

  if not (
    v_order.payment_status in ('paid', 'succeeded')
    or v_order.status in ('confirmed', 'shipped', 'delivered')
  ) then
    raise exception 'Cette commande n''est pas encore payée';
  end if;

  select * into v_profile from public.profiles where id = coalesce(v_order.placed_by_profile_id, (select id from public.profiles where email = v_order.email limit 1));
  if v_profile is null then
    raise exception 'Impossible de résoudre le profil client de cette commande';
  end if;
  if v_profile.legal_status is null then
    raise exception 'Statut juridique manquant : complétez le profil du client avant de générer sa facture';
  end if;

  v_invoice_type := case when v_profile.legal_status = 'individual' then 'b2c_retail' else 'b2b_facturx' end;

  if v_profile.legal_status = 'individual' then
    v_billing := jsonb_build_object(
      'name', trim(coalesce(v_profile.first_name, '') || ' ' || coalesce(v_profile.last_name, '')),
      'address', v_profile.address,
      'city', v_profile.city,
      'postal_code', v_profile.postal_code,
      'country', public.country_name_to_iso(v_profile.country)
    );
  else
    v_billing := jsonb_build_object(
      'entity_name', v_profile.legal_entity_name,
      'legal_form', v_profile.legal_form,
      'siret', v_profile.siret,
      'vat_number', v_profile.vat_number,
      'address', v_profile.legal_address,
      'city', v_profile.legal_city,
      'postal_code', v_profile.legal_postal_code,
      'country', public.country_name_to_iso(v_profile.legal_country)
    );
  end if;

  v_year := extract(year from v_order.created_at)::int;

  insert into public.invoice_counters (year, last_number) values (v_year, 0)
    on conflict (year) do nothing;

  update public.invoice_counters
  set last_number = last_number + 1
  where year = v_year
  returning last_number into v_next_number;

  v_invoice_number := 'FAC-' || v_year || '-' || lpad(v_next_number::text, 5, '0');

  insert into public.invoices (order_id, profile_id, invoice_number, total_amount, legal_status, billing_details, issued_at, invoice_type, transmission_status)
  values (p_order_id, v_profile.id, v_invoice_number, v_order.total_amount, v_profile.legal_status, v_billing, now(), v_invoice_type, 'not_applicable')
  returning id into v_invoice_id;

  return jsonb_build_object('already_generated', false, 'invoice_id', v_invoice_id, 'invoice_number', v_invoice_number, 'invoice_type', v_invoice_type);
end;
$$;

grant execute on function public.generate_invoice_for_order(uuid) to authenticated;

notify pgrst, 'reload schema';
