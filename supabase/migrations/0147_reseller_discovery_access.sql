-- ============================================================================
-- Accès "découverte" : un revendeur peut désormais être placé dans un
-- nouveau statut resellers.status = 'discovery', qui lui donne accès à TOUT
-- l'espace B2B en lecture seule (catalogue avec prix, drops, sessions
-- d'enchères en cours, missions de sourcing) mais lui interdit tout achat,
-- toute enchère et toute validation de mission.
--
-- Architecture retenue : current_reseller_id() (utilisée partout pour la
-- RLS de lecture ET comme porte d'entrée de nombreuses actions) accepte
-- désormais aussi bien 'active' que 'discovery' — sinon un compte découverte
-- ne verrait RIEN du tout, la RLS de lecture (orders_reseller_select_own,
-- b2b_catalog, etc.) en dépendant systématiquement. Une nouvelle fonction
-- dédiée, reseller_can_transact(), reste strictement réservée à 'active' et
-- doit être appelée explicitement par chaque action qui engage un paiement
-- ou une enchère — jamais déduite implicitement de current_reseller_id().
--
-- Actions concernées et bloquées ici :
--   - place_auto_bid (enchères)
--   - reseller_validate_sourcing_mission (engagement sur une mission de
--     sourcing, crée une commande payée)
--   - b2b-checkout (Edge Function, catalogue + drops) : la vérification y
--     est ajoutée séparément côté TypeScript, cette fonction RPC n'ayant
--     pas accès à auth.uid() quand elle est appelée par l'Edge Function
--     via le client service-role.
-- ============================================================================

alter table public.resellers drop constraint if exists resellers_status_check;
alter table public.resellers
  add constraint resellers_status_check check (status in ('pending', 'active', 'suspended', 'deleted', 'discovery'));

create or replace function public.current_reseller_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select rc.reseller_id
  from public.reseller_contacts rc
  join public.resellers rs on rs.id = rc.reseller_id
  where rc.profile_id = auth.uid() and rs.status in ('active', 'discovery')
  limit 1;
$$;

-- ----------------------------------------------------------------------------
-- reseller_can_transact : true uniquement pour un compte 'active' — jamais
-- 'discovery' (même si current_reseller_id() renvoie un id pour les deux).
-- À appeler explicitement dans toute action qui engage un paiement ou une
-- enchère, jamais en se fiant à current_reseller_id() seul pour ça.
-- ----------------------------------------------------------------------------
create or replace function public.reseller_can_transact()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.reseller_contacts rc
    join public.resellers rs on rs.id = rc.reseller_id
    where rc.profile_id = auth.uid() and rs.status = 'active'
  );
$$;

grant execute on function public.reseller_can_transact() to authenticated;

-- ----------------------------------------------------------------------------
-- place_auto_bid (0138) : ajoute le contrôle reseller_can_transact(), corps
-- identique sinon.
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
  v_item record;
  v_session_status text;
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
    v_new_price := v_item.current_price + v_item.min_increment;
    v_new_winner := v_user_id;
    v_new_max := p_max_amount;
    v_bid_amount := v_new_price;

  elsif v_item.current_winner_id = v_user_id then
    if p_max_amount <= v_item.current_max_amount then
      return query select false, 'Vous êtes déjà le meilleur enchérisseur sur ce lot.'::text, v_item.current_price, true, v_item.current_max_amount;
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

-- ----------------------------------------------------------------------------
-- reseller_validate_sourcing_mission (0122) : ajoute le contrôle
-- reseller_can_transact() (crée une commande payée), corps identique sinon.
-- ----------------------------------------------------------------------------
create or replace function public.reseller_validate_sourcing_mission(p_mission_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mission record;
  v_reseller_email text;
  v_order_id uuid;
  v_item_count integer;
  v_total_cost numeric;
  v_remainder numeric;
  v_first_item_id uuid;
begin
  if not public.reseller_can_transact() then
    raise exception 'Accès découverte : validation de mission non autorisée sur ce compte';
  end if;

  select * into v_mission from public.b2b_sourcing_missions where id = p_mission_id for update;
  if v_mission is null then
    raise exception 'Mission introuvable';
  end if;

  if v_mission.user_id is distinct from auth.uid() then
    raise exception 'Accès refusé';
  end if;

  if v_mission.status <> 'active' then
    raise exception 'Cette mission n''est plus en cours de sélection';
  end if;
  if not v_mission.is_published_to_reseller then
    raise exception 'Cette mission n''est pas encore prête à être validée';
  end if;

  create temporary table tmp_sourcing_alloc (
    item_id uuid primary key,
    product_id uuid,
    cost_price numeric,
    alloc numeric
  ) on commit drop;

  insert into tmp_sourcing_alloc (item_id, product_id, cost_price)
  select i.id, i.product_id, coalesce(i.cost_price, 0)
  from public.b2b_sourcing_items i
  where i.mission_id = p_mission_id and i.status <> 'cancelled';

  select count(*) into v_item_count from tmp_sourcing_alloc;
  if v_item_count = 0 then
    raise exception 'Aucune pièce à valider sur cette mission';
  end if;

  if exists (select 1 from tmp_sourcing_alloc where product_id is null) then
    raise exception 'Certaines pièces ne sont pas encore finalisées par notre équipe — contactez-nous avant de valider';
  end if;

  perform 1 from public.products p join tmp_sourcing_alloc t on t.product_id = p.id for update;

  if exists (
    select 1 from tmp_sourcing_alloc t join public.products p on p.id = t.product_id
    where p.status not in ('draft', 'sourced-b2b')
  ) then
    raise exception 'Certaines pièces ne sont plus disponibles — contactez notre équipe';
  end if;

  select coalesce(sum(cost_price), 0) into v_total_cost from tmp_sourcing_alloc;

  if v_total_cost > 0 then
    update tmp_sourcing_alloc set alloc = round(v_mission.advance_amount * cost_price / v_total_cost, 2) where true;
  else
    update tmp_sourcing_alloc set alloc = round(v_mission.advance_amount / v_item_count, 2) where true;
  end if;

  select v_mission.advance_amount - coalesce(sum(alloc), 0) into v_remainder from tmp_sourcing_alloc;
  select item_id into v_first_item_id from tmp_sourcing_alloc order by item_id limit 1;
  update tmp_sourcing_alloc set alloc = alloc + v_remainder where item_id = v_first_item_id;

  select contact_email into v_reseller_email from public.resellers where id = v_mission.reseller_id;

  insert into public.orders (
    order_number, email, status, total_amount, subtotal, shipping_cost, currency,
    payment_status, reseller_id, placed_by_profile_id,
    order_channel, approval_status, approved_at
  ) values (
    v_mission.reference, v_reseller_email, 'confirmed', v_mission.advance_amount, v_mission.advance_amount, 0, 'EUR',
    'paid', v_mission.reseller_id, v_mission.user_id,
    'b2b', 'approved', now()
  )
  returning id into v_order_id;

  insert into public.order_items (order_id, product_id, quantity, unit_price, line_total, product_snapshot)
  select v_order_id, p.id, 1, t.alloc, t.alloc, to_jsonb(p.*)
  from tmp_sourcing_alloc t
  join public.products p on p.id = t.product_id;

  update public.products p
  set status = 'sold-b2b', reserved_by_reseller_id = v_mission.reseller_id, reserved_by_order_id = v_order_id, reserved_at = now()
  from tmp_sourcing_alloc t
  where p.id = t.product_id;

  update public.b2b_sourcing_items
  set status = 'validated'
  where mission_id = p_mission_id and status <> 'cancelled';

  update public.b2b_sourcing_missions
  set status = 'completed', order_id = v_order_id
  where id = p_mission_id;

  return jsonb_build_object('order_id', v_order_id, 'order_number', v_mission.reference);
end;
$$;

notify pgrst, 'reload schema';
