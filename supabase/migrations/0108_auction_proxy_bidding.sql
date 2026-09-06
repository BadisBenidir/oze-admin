-- ============================================================================
-- Enchère automatique (proxy bidding) : le revendeur ne saisit plus un
-- montant ponctuel mais un plafond secret (max_amount). Le système place la
-- mise minimale nécessaire pour mener et resurenchérit seul, jusqu'à ce
-- plafond, dès qu'un concurrent dépose une mise.
--
-- Remplace entièrement l'ancien flux de 0104 (insert direct par le
-- revendeur + trigger on_new_auction_bid/handle_new_bid) : comparer le
-- nouveau plafond à celui du meneur actuel exige de lire
-- auction_items.current_max_amount, qui doit rester invisible côté client
-- (jamais exposé par reseller_auction_items, 0107) — impossible à faire
-- correctement depuis un insert direct piloté par le navigateur. Toute la
-- logique (validation, calcul du nouveau prix public, insertion de la ligne
-- d'audit) est donc désormais portée par une unique fonction SECURITY
-- DEFINER, place_auto_bid().
-- ============================================================================

alter table public.auction_bids add column if not exists max_amount numeric(10, 2);

alter table public.auction_items add column if not exists current_max_amount numeric(10, 2);
comment on column public.auction_items.current_max_amount is
  'Plafond secret du meneur actuel (proxy bidding) — jamais exposé côté revendeur, voir reseller_auction_items (0107) qui ne le sélectionne pas.';

-- L'ancien trigger validait une mise "au comptant" à montant fixe ; incompatible
-- avec le proxy bidding, où la ligne d'audit d'un enchérisseur immédiatement
-- surenchéri porte un montant (son plafond) inférieur au nouveau current_price
-- affiché — cette même mise serait rejetée par l'ancienne validation stricte.
drop trigger if exists on_new_auction_bid on public.auction_bids;
drop function if exists public.handle_new_bid();

-- Un revendeur ne doit plus pouvoir insérer directement une ligne dans
-- auction_bids : le plafond du meneur actuel doit rester secret, or un
-- insert direct nécessiterait de l'exposer côté client pour calculer le
-- nouveau prix. RLS reste activée sans policy INSERT pour les revendeurs :
-- seule place_auto_bid() (security definer, contourne la RLS) écrit
-- désormais dans cette table pour leur compte ; l'admin conserve son accès
-- complet via auction_bids_admin_all (for all using is_admin()).
drop policy if exists auction_bids_reseller_insert on public.auction_bids;

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
    -- L'utilisateur relève son propre plafond : personne d'autre à
    -- surenchérir, le prix public ne bouge pas, seul le plafond stocké change.
    if p_max_amount <= v_item.current_max_amount then
      return query select false, 'Vous menez déjà avec un plafond au moins égal'::text, v_item.current_price, true, v_item.current_max_amount;
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

grant execute on function public.place_auto_bid(uuid, numeric) to authenticated;

notify pgrst, 'reload schema';
