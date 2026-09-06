-- ============================================================================
-- Statut juridique obligatoire du revendeur (Particulier / Entreprise
-- Individuelle / Société) — conditionne le droit de rétractation applicable
-- (B2C 14 jours vs B2B) et les mentions légales à faire figurer sur les
-- factures. Vit sur `resellers` (l'entité "compte", pas le contact
-- individuel) : company_name/legal_id y existent déjà (0011), et un statut
-- juridique est une caractéristique de l'ENTITÉ facturée, pas de la personne
-- qui se connecte — cohérent même quand ce compte ne représente en réalité
-- qu'un particulier (company_name sert alors juste de nom d'affichage).
--
-- `legal_id` (existant, libre : "SIRET / n° TVA intracommunautaire" en un
-- seul champ texte) reste inchangé pour ne pas perdre les données déjà
-- saisies ; siret/vat_number ci-dessous sont les nouveaux champs structurés
-- que le formulaire (admin ET revendeur) doit désormais utiliser.
-- ============================================================================

alter table public.resellers
  add column if not exists legal_status text check (legal_status in ('individual', 'sole_proprietorship', 'company')),
  add column if not exists siret text,
  add column if not exists vat_number text,
  add column if not exists legal_form text;

comment on column public.resellers.legal_status is
  'individual = particulier (droit de rétractation 14 jours) ; sole_proprietorship = EI/auto-entrepreneur ; company = société (SAS, SARL...).';
comment on column public.resellers.siret is 'SIRET (14 chiffres) — obligatoire hors "individual". Distinct de legal_id (ancien champ libre, conservé).';
comment on column public.resellers.legal_form is 'Forme juridique (SAS, SARL, EURL...) — uniquement pour legal_status = ''company''.';

-- ----------------------------------------------------------------------------
-- Écriture par le revendeur lui-même : `resellers` n'a aucune policy RLS
-- d'UPDATE pour le rôle revendeur (voir 0002_b2b_rls.sql — seul is_admin()
-- peut écrire directement) et ce n'est pas ici qu'on l'ouvre en grand. Même
-- convention que cart_add_item/place_auto_bid : une RPC SECURITY DEFINER
-- étroite, gardée par current_reseller_id(), qui ne touche que les colonnes
-- concernées.
-- ----------------------------------------------------------------------------
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
  v_siret text := nullif(trim(coalesce(p_siret, '')), '');
  v_vat text := nullif(trim(coalesce(p_vat_number, '')), '');
  v_legal_form text := nullif(trim(coalesce(p_legal_form, '')), '');
  v_company_name text := nullif(trim(coalesce(p_company_name, '')), '');
begin
  if v_reseller_id is null then
    raise exception 'Aucun compte revendeur actif associé à cet utilisateur';
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

-- ----------------------------------------------------------------------------
-- Blocage serveur des enchères tant que le statut juridique n'est pas
-- renseigné (défense en profondeur : le blocage côté React, contournable,
-- ne suffit pas — même principe déjà appliqué partout ailleurs dans ce
-- schéma, ex. les prix jamais acceptés tels quels du client dans
-- b2b-checkout). Reprend intégralement place_auto_bid (0108), seule la
-- garde ajoutée juste après la vérification d'identité change.
-- ----------------------------------------------------------------------------
create or replace function public.place_auto_bid(p_item_id uuid, p_max_amount numeric)
returns table (
  success boolean,
  message text,
  new_price numeric,
  is_winning boolean,
  my_max_amount numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_reseller_id uuid;
  v_legal_status text;
  v_item record;
  v_new_price numeric;
  v_new_winner uuid;
  v_new_max numeric;
  v_bid_amount numeric;
  v_outbid boolean := false;
begin
  v_reseller_id := public.current_reseller_id();

  if v_user_id is null or v_reseller_id is null then
    return query select false, 'Non autorisé'::text, null::numeric, false, null::numeric;
    return;
  end if;

  select legal_status into v_legal_status from public.resellers where id = v_reseller_id;
  if v_legal_status is null then
    return query select false, 'Merci de renseigner votre statut juridique dans votre profil avant d''enchérir'::text, null::numeric, false, null::numeric;
    return;
  end if;

  if p_max_amount is null or p_max_amount <= 0 then
    return query select false, 'Montant invalide'::text, null::numeric, false, null::numeric;
    return;
  end if;

  select * into v_item from public.auction_items where id = p_item_id for update;

  if not found then
    return query select false, 'Pièce introuvable'::text, null::numeric, false, null::numeric;
    return;
  end if;

  if v_item.status <> 'active' or v_item.ends_at <= now() then
    return query select false, 'Cette enchère est terminée'::text, v_item.current_price, false, null::numeric;
    return;
  end if;

  if p_max_amount < v_item.current_price + v_item.min_increment then
    return query select false,
      format('Montant insuffisant, minimum : %s €', to_char(v_item.current_price + v_item.min_increment, 'FM999999990.00')),
      v_item.current_price, false, null::numeric;
    return;
  end if;

  if v_item.current_winner_id is null then
    v_new_price := v_item.current_price + v_item.min_increment;
    v_new_winner := v_user_id;
    v_new_max := p_max_amount;
    v_bid_amount := v_new_price;

  elsif v_item.current_winner_id = v_user_id then
    if p_max_amount <= v_item.current_max_amount then
      return query select false, 'Vous menez déjà avec un plafond au moins égal'::text, v_item.current_price, true, v_item.current_max_amount;
      return;
    end if;
    v_new_price := v_item.current_price;
    v_new_winner := v_user_id;
    v_new_max := p_max_amount;
    v_bid_amount := v_new_price;

  elsif p_max_amount > v_item.current_max_amount then
    v_new_price := least(p_max_amount, greatest(v_item.current_price + v_item.min_increment, v_item.current_max_amount + v_item.min_increment));
    v_new_winner := v_user_id;
    v_new_max := p_max_amount;
    v_bid_amount := v_new_price;

  else
    v_new_price := least(v_item.current_max_amount, p_max_amount + v_item.min_increment);
    v_new_winner := v_item.current_winner_id;
    v_new_max := v_item.current_max_amount;
    v_bid_amount := p_max_amount;
    v_outbid := true;
  end if;

  update public.auction_items
  set current_price = v_new_price,
      current_winner_id = v_new_winner,
      current_max_amount = v_new_max,
      ends_at = case when ends_at - now() < interval '5 minutes' then now() + interval '5 minutes' else ends_at end
  where id = p_item_id;

  insert into public.auction_bids (item_id, user_id, amount, max_amount)
  values (p_item_id, v_user_id, v_bid_amount, p_max_amount);

  if v_outbid then
    return query select true, 'Vous avez été immédiatement surenchéri par une offre plafond existante'::text, v_new_price, false, p_max_amount;
  else
    return query select true, null::text, v_new_price, true, v_new_max;
  end if;
end;
$$;

grant execute on function public.place_auto_bid(uuid, numeric) to authenticated;

notify pgrst, 'reload schema';
