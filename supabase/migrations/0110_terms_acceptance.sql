-- ============================================================================
-- Acceptation des CGV/CGU (Terms.tsx) — case à cocher obligatoire au
-- checkout et avant de pouvoir enchérir (voir CartPage.tsx / Auctions.tsx).
-- Contrairement à legal_status (0109), pas de règle métier conditionnelle à
-- valider (juste horodater un consentement) : un simple update direct sur
-- `profiles` suffit, la policy RLS d'auto-édition existante (dashboard,
-- déjà utilisée par ResellerProfile.tsx pour phone/adresse) couvre déjà ce
-- cas — aucune RPC nécessaire.
-- ============================================================================

alter table public.profiles
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists terms_version text;

comment on column public.profiles.terms_accepted_at is
  'Horodatage du premier consentement explicite aux CGV/CGU (voir Terms.tsx, config/legal.ts:CGV_VERSION) — condition bloquante pour enchérir (place_auto_bid), reconfirmé par case à cocher à chaque commande (CartPage.tsx) sans re-timestamper.';
comment on column public.profiles.terms_version is 'Version des CGV (CGV_VERSION) au moment du premier consentement.';

-- ----------------------------------------------------------------------------
-- Même garde que pour legal_status (0109) : un blocage React seul
-- (Auctions.tsx) resterait contournable en appelant place_auto_bid
-- directement.
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
  v_terms_accepted_at timestamptz;
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

  select legal_status, terms_accepted_at into v_legal_status, v_terms_accepted_at from public.profiles where id = v_user_id;

  if v_legal_status is null then
    return query select false, 'Merci de renseigner votre statut juridique dans votre profil avant d''enchérir'::text, null::numeric, false, null::numeric;
    return;
  end if;

  if v_terms_accepted_at is null then
    return query select false, 'Merci d''accepter les CGV avant d''enchérir'::text, null::numeric, false, null::numeric;
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
