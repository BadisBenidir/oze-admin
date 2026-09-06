-- ============================================================================
-- Statut juridique obligatoire du revendeur (Particulier / Entreprise
-- Individuelle / Société) — conditionne le droit de rétractation applicable
-- (B2C 14 jours vs B2B) et les mentions légales à faire figurer sur les
-- factures.
--
-- Vit sur `profiles`, PAS sur `resellers` : indépendant pour chaque
-- sous-compte d'une même entreprise (un login = un statut, jamais partagé
-- entre collègues d'un même `reseller_id`) — même logique déjà établie pour
-- l'adresse individuelle du contact (0023 : distincte de l'adresse de
-- l'entreprise sur `resellers`). `legal_entity_name`/siret/vat_number/
-- legal_form/adresse légale ci-dessous appartiennent donc à CE profil, pas
-- à `resellers.company_name` qui reste le nom d'affichage partagé de
-- l'entreprise dans la nav.
-- ============================================================================

alter table public.profiles
  add column if not exists legal_status text check (legal_status in ('individual', 'sole_proprietorship', 'company')),
  add column if not exists legal_entity_name text,
  add column if not exists siret text,
  add column if not exists vat_number text,
  add column if not exists legal_form text,
  add column if not exists legal_address text,
  add column if not exists legal_city text,
  add column if not exists legal_postal_code text,
  add column if not exists legal_country text default 'France';

comment on column public.profiles.legal_status is
  'individual = particulier (droit de rétractation 14 jours) ; sole_proprietorship = EI/auto-entrepreneur ; company = société (SAS, SARL...). Indépendant par sous-compte.';
comment on column public.profiles.legal_entity_name is 'Nom officiel de l''EI ou dénomination sociale — vide pour "individual" (nom/prénom du profil suffisent déjà).';
comment on column public.profiles.siret is 'SIRET (14 chiffres) — obligatoire hors "individual".';
comment on column public.profiles.legal_form is 'Forme juridique (SAS, SARL, EURL...) — uniquement pour legal_status = ''company''.';
comment on column public.profiles.legal_address is 'Adresse de facturation pro / siège social — distincte de profiles.address (adresse de livraison personnelle, 0023).';

-- Design précédent (jamais déployé) : ces colonnes avaient été ajoutées par
-- erreur sur `resellers` (partagées par toute l'entreprise) avant ce
-- correctif — supprimées si présentes pour ne garder qu'une seule source de
-- vérité.
alter table public.resellers
  drop column if exists legal_status,
  drop column if exists siret,
  drop column if exists vat_number,
  drop column if exists legal_form;

-- ----------------------------------------------------------------------------
-- Écriture par le revendeur lui-même, sur SON PROPRE profil uniquement
-- (auth.uid()) — définitif une fois choisi : un revendeur ne peut plus le
-- changer après la première validation (empêche "je me déclare Particulier
-- pour éviter telle contrainte, puis je repasse en Société plus tard"). Un
-- admin OZË garde la main pour corriger une erreur de saisie, via
-- admin-update-contact-profile (service role, jamais concerné par ce
-- verrou). SECURITY DEFINER car `profiles` n'a pas de policy RLS d'update
-- pour ces colonnes suivant la convention dashboard existante.
-- ----------------------------------------------------------------------------
-- Une exécution partielle antérieure de cette migration a pu créer la
-- fonction avec l'ancien nom de paramètre p_company_name (avant le passage
-- à p_legal_entity_name) — `create or replace` refuse de renommer un
-- paramètre d'entrée, il faut donc explicitement supprimer l'ancienne
-- signature avant de recréer.
drop function if exists public.set_reseller_legal_info(text, text, text, text, text, text, text, text, text);

create function public.set_reseller_legal_info(
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
  v_siret text := nullif(trim(coalesce(p_siret, '')), '');
  v_vat text := nullif(trim(coalesce(p_vat_number, '')), '');
  v_legal_form text := nullif(trim(coalesce(p_legal_form, '')), '');
  v_entity_name text := nullif(trim(coalesce(p_legal_entity_name, '')), '');
begin
  if v_user_id is null or public.current_reseller_id() is null then
    raise exception 'Aucun compte revendeur actif associé à cet utilisateur';
  end if;

  select legal_status into v_current_status from public.profiles where id = v_user_id;
  if v_current_status is not null then
    raise exception 'Le statut juridique a déjà été défini et ne peut plus être modifié. Contactez votre administrateur OZË Paris pour le corriger.';
  end if;

  if p_legal_status not in ('individual', 'sole_proprietorship', 'company') then
    raise exception 'Statut juridique invalide';
  end if;

  if p_legal_status in ('sole_proprietorship', 'company') then
    if v_entity_name is null then
      raise exception 'La dénomination est obligatoire pour ce statut';
    end if;
    if v_siret is null or v_siret !~ '^[0-9]{14}$' then
      raise exception 'Le numéro SIRET doit comporter exactement 14 chiffres';
    end if;
  end if;

  if p_legal_status = 'company' and v_legal_form is null then
    raise exception 'La forme juridique est obligatoire pour une société';
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
      legal_country = case when p_legal_status = 'individual' then null else coalesce(nullif(trim(coalesce(p_country, '')), ''), 'France') end
  where id = v_user_id;

  return jsonb_build_object('success', true);
end;
$$;

grant execute on function public.set_reseller_legal_info(text, text, text, text, text, text, text, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- Blocage serveur des enchères tant que CE profil n'a pas renseigné son
-- statut juridique (défense en profondeur : le blocage côté React seul,
-- contournable, ne suffit pas). Reprend intégralement place_auto_bid
-- (0108), seule la garde ajoutée juste après la vérification d'identité
-- change — et interroge désormais profiles, pas resellers.
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
  v_legal_status text;
  v_item record;
  v_new_price numeric;
  v_new_winner uuid;
  v_new_max numeric;
  v_bid_amount numeric;
  v_outbid boolean := false;
begin
  if v_user_id is null or public.current_reseller_id() is null then
    return query select false, 'Non autorisé'::text, null::numeric, false, null::numeric;
    return;
  end if;

  select legal_status into v_legal_status from public.profiles where id = v_user_id;
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
