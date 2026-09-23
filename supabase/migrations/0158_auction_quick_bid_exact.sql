-- ============================================================================
-- Boutons d'enchère rapide (+5 / +10 / +15 €) : mise FERME au montant affiché.
--
-- Bug remonté en session : les boutons rapides appelaient place_auto_bid avec
-- p_max_amount = prix + palier, traité comme un PLAFOND d'enchère automatique.
-- Le prix ne montait donc que du pas minimal (+5 €) et la différence restait
-- en plafond caché. Ex. : lot à 45 €, clic "+10 €" -> prix affiché 50 €,
-- plafond caché 55 € ; le suivant qui clique "+5 €" (55 €) est aussitôt
-- surenchéri et doit mettre +10 € pour passer devant.
--
-- p_exact = true (boutons rapides) : si l'enchérisseur passe devant, le prix
-- devient EXACTEMENT le montant cliqué et son plafond = ce montant (aucune
-- réserve cachée). Face à un plafond concurrent supérieur ou égal, même
-- comportement qu'avant (surenchéri automatiquement).
-- p_exact = false (défaut, "Définir max") : proxy bidding inchangé.
--
-- Rétablit aussi les contrôles statut juridique (0109) et CGV (0110), perdus
-- quand 0128/0138 ont redéfini la fonction sans eux.
-- ============================================================================

drop function if exists public.place_auto_bid(uuid, numeric);

create or replace function public.place_auto_bid(p_item_id uuid, p_max_amount numeric, p_exact boolean default false)
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
  v_session_status text;
  v_legal_status text;
  v_terms_accepted_at timestamptz;
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

  if not public.reseller_can_transact() then
    return query select false, 'Accès découverte : les enchères ne sont pas ouvertes à votre compte'::text, null::numeric, false, null::numeric;
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

  if v_item is null then
    return query select false, 'Pièce introuvable'::text, null::numeric, false, null::numeric;
    return;
  end if;

  select status into v_session_status from public.auction_sessions where id = v_item.session_id;
  if v_session_status is distinct from 'live' then
    return query select false,
      'Cette session n''est pas encore ouverte aux enchères — ceci n''est qu''un aperçu.'::text,
      v_item.current_price, false, null::numeric;
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
    v_new_price := case when p_exact then p_max_amount else v_item.current_price + v_item.min_increment end;
    v_new_winner := v_user_id;
    v_new_max := p_max_amount;
    v_bid_amount := v_new_price;

  elsif v_item.current_winner_id = v_user_id then
    if p_exact or p_max_amount <= v_item.current_max_amount then
      return query select false, 'Vous êtes déjà le meilleur enchérisseur sur ce lot.'::text, v_item.current_price, true, v_item.current_max_amount;
      return;
    end if;
    v_new_price := v_item.current_price;
    v_new_winner := v_user_id;
    v_new_max := p_max_amount;
    v_bid_amount := v_new_price;

  elsif p_max_amount > v_item.current_max_amount then
    v_new_price := case
      when p_exact then p_max_amount
      else least(p_max_amount, greatest(v_item.current_price + v_item.min_increment, v_item.current_max_amount + v_item.min_increment))
    end;
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

revoke all on function public.place_auto_bid(uuid, numeric, boolean) from public, anon;
grant execute on function public.place_auto_bid(uuid, numeric, boolean) to authenticated;

notify pgrst, 'reload schema';
