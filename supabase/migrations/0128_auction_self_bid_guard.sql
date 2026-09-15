-- ============================================================================
-- Durcit le message renvoyé quand le meneur actuel tente de "surenchérir
-- contre lui-même" via place_auto_bid (0108). Le garde-fou empêchant toute
-- inflation artificielle du prix existait déjà (branche
-- `v_item.current_winner_id = v_user_id`, ligne ~97 de 0108) : v_new_price
-- y est TOUJOURS égal à v_item.current_price (jamais augmenté) quand le
-- meneur est déjà l'utilisateur courant — un clic sur +5€/+10€/+20€ pendant
-- qu'on mène déjà ne peut donc jamais faire grimper le prix public. Seule
-- exception, déjà présente et volontairement conservée : relever son PROPRE
-- plafond secret (current_max_amount) au-dessus de sa valeur actuelle reste
-- autorisé, sans jamais toucher au prix public.
--
-- Le seul changement ici est le message d'erreur, pour être explicite plutôt
-- que de laisser croire à un plafond "au moins égal" (ambigu) : on dit
-- clairement à l'utilisateur qu'il est déjà meilleur enchérisseur. Le
-- blocage réel côté UI (désactivation des boutons +5/+10/+20 quand
-- isWinning) vit dans Auctions.tsx / AuctionItemDetailModal.tsx.
-- ============================================================================

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
    -- Personne ne mène encore : le nouveau plafond prend la tête au minimum requis.
    v_new_price := v_item.current_price + v_item.min_increment;
    v_new_winner := v_user_id;
    v_new_max := p_max_amount;
    v_bid_amount := v_new_price;

  elsif v_item.current_winner_id = v_user_id then
    -- Garde-fou anti auto-surenchère : le prix public ne bouge JAMAIS ici
    -- (v_new_price reste v_item.current_price plus bas), qu'on accepte ou
    -- non la requête. Seul un plafond strictement supérieur au sien est
    -- accepté, et il ne fait que relever la réserve secrète, jamais le prix
    -- affiché tant qu'aucun concurrent n'a déposé de mise en face.
    if p_max_amount <= v_item.current_max_amount then
      return query select false, 'Vous êtes déjà le meilleur enchérisseur sur ce lot.'::text, v_item.current_price, true, v_item.current_max_amount;
      return;
    end if;
    v_new_price := v_item.current_price;
    v_new_winner := v_user_id;
    v_new_max := p_max_amount;
    v_bid_amount := v_new_price;

  elsif p_max_amount > v_item.current_max_amount then
    -- Cas A : le nouveau plafond dépasse celui du meneur actuel, il prend la tête.
    v_new_price := least(p_max_amount, greatest(v_item.current_price + v_item.min_increment, v_item.current_max_amount + v_item.min_increment));
    v_new_winner := v_user_id;
    v_new_max := p_max_amount;
    v_bid_amount := v_new_price;

  else
    -- Cas B/C : le meneur actuel a un plafond supérieur ou égal (égalité
    -- stricte incluse : priorité au premier arrivé), il reste en tête. Le
    -- prix public saute au minimum nécessaire pour battre ce nouveau
    -- plafond, sans jamais dépasser le plafond du meneur.
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

notify pgrst, 'reload schema';
