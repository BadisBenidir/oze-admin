-- ============================================================================
-- Assignation automatique des portefeuilles offerts (b2b_gift_rewards,
-- voir 0101) à la commande B2B correspondante, et synchronisation de leur
-- statut sur l'état réel de cette commande.
--
-- Règle d'assignation : pour un même profil (profile_id = orders.placed_by
-- _profile_id — l'individu qui recharge ET commande, jamais l'entreprise),
-- les cadeaux encore sans commande sont consommés chronologiquement sur les
-- commandes B2B (non annulées) passées à ou après la date de la recharge
-- qui les a générés — une commande ne sert jamais à deux cadeaux à la fois.
--
-- Synchronisation : un cadeau assigné (`assigned`) bascule automatiquement
-- à `shipped` dès que TOUS les articles actifs de sa commande atteignent
-- 'shipped' ou 'delivered' (même définition que computeB2BOrderStatus côté
-- client, useB2BOrders.ts — jamais dupliquée avec une logique différente),
-- avec shipped_at posé sur la date réelle d'expédition/livraison de la
-- commande (order_items.shipped_at/delivered_at, voir 0086). Une commande
-- annulée après coup n'est PAS traitée ici (hors périmètre de cette
-- demande) : le cadeau reste affiché comme assigné à une commande qui
-- n'aboutira pas, à traiter manuellement si ça se présente.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Resynchronise un cadeau assigné sur l'état réel de sa commande.
-- ----------------------------------------------------------------------------
create or replace function public.sync_gift_reward_from_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_status text;
  v_min_rank int;
  v_max_rank int;
  v_ship_ts timestamptz;
begin
  select status into v_order_status from public.orders where id = p_order_id;
  if v_order_status is null or v_order_status = 'cancelled' then
    return;
  end if;

  select
    min(case oi.fulfillment_status
      when 'ordered' then 0 when 'received' then 1 when 'ready_to_ship' then 2
      when 'delivery_requested' then 3 when 'label_created' then 4 when 'shipped' then 5 when 'delivered' then 6
      else 0 end),
    max(case oi.fulfillment_status
      when 'ordered' then 0 when 'received' then 1 when 'ready_to_ship' then 2
      when 'delivery_requested' then 3 when 'label_created' then 4 when 'shipped' then 5 when 'delivered' then 6
      else 0 end)
  into v_min_rank, v_max_rank
  from public.order_items oi
  where oi.order_id = p_order_id and oi.status = 'active';

  -- Aucun article actif (commande vidée par annulations individuelles) :
  -- rien à synchroniser.
  if v_min_rank is null then
    return;
  end if;

  -- 'delivered' (rang 6) exige TOUS les articles actifs livrés ; 'shipped'
  -- (rang 5) suffit dès qu'AU MOINS un article l'a atteint — même règle que
  -- computeB2BOrderStatus.
  if v_min_rank >= 6 then
    select max(coalesce(oi.delivered_at, oi.shipped_at)) into v_ship_ts
    from public.order_items oi where oi.order_id = p_order_id and oi.status = 'active';
  elsif v_max_rank >= 5 then
    select max(oi.shipped_at) into v_ship_ts
    from public.order_items oi where oi.order_id = p_order_id and oi.status = 'active';
  else
    return;
  end if;

  update public.b2b_gift_rewards
  set status = 'shipped', shipped_at = coalesce(shipped_at, v_ship_ts, now())
  where assigned_order_id = p_order_id and status <> 'shipped';
end;
$$;

revoke all on function public.sync_gift_reward_from_order(uuid) from public, authenticated;

-- ----------------------------------------------------------------------------
-- Assigne chronologiquement chaque cadeau encore sans commande à la
-- première commande B2B éligible non encore prise par un autre cadeau.
-- Idempotente : peut être rejouée sans effet si tout est déjà assigné.
-- ----------------------------------------------------------------------------
create or replace function public.assign_pending_gift_rewards()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile record;
  v_gift record;
  v_order_id uuid;
begin
  for v_profile in
    select distinct profile_id from public.b2b_gift_rewards where assigned_order_id is null and status = 'pending'
  loop
    for v_gift in
      select g.id, coalesce(wt.created_at, g.created_at) as recharge_date
      from public.b2b_gift_rewards g
      join public.wallet_transactions wt on wt.id = g.transaction_id
      where g.profile_id = v_profile.profile_id and g.assigned_order_id is null and g.status = 'pending'
      order by coalesce(wt.created_at, g.created_at) asc
    loop
      select o.id into v_order_id
      from public.orders o
      where o.placed_by_profile_id = v_profile.profile_id
        and o.order_channel = 'b2b'
        and o.status <> 'cancelled'
        and o.created_at >= v_gift.recharge_date
        and not exists (select 1 from public.b2b_gift_rewards g2 where g2.assigned_order_id = o.id)
      order by o.created_at asc
      limit 1;

      if v_order_id is not null then
        update public.b2b_gift_rewards set status = 'assigned', assigned_order_id = v_order_id where id = v_gift.id;
        perform public.sync_gift_reward_from_order(v_order_id);
      end if;

      v_order_id := null;
    end loop;
  end loop;
end;
$$;

revoke all on function public.assign_pending_gift_rewards() from public, authenticated;

-- ----------------------------------------------------------------------------
-- Déclencheurs : toute nouvelle commande B2B retente l'assignation (couvre
-- le cas "le cadeau est en attente et la commande vient tout juste d'être
-- passée") ; tout changement de fulfillment_status resynchronise le cadeau
-- de la commande concernée (couvre chaque point de la chaîne d'expédition
-- — réception, prêt à expédier, étiquette, webhook transporteur... — sans
-- avoir à les modifier individuellement).
-- ----------------------------------------------------------------------------
create or replace function public.trg_assign_gift_rewards_on_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.order_channel = 'b2b' and new.status <> 'cancelled' then
    perform public.assign_pending_gift_rewards();
  end if;
  return new;
end;
$$;

drop trigger if exists assign_gift_rewards_on_order_insert on public.orders;
create trigger assign_gift_rewards_on_order_insert
after insert on public.orders
for each row execute function public.trg_assign_gift_rewards_on_order();

create or replace function public.trg_sync_gift_reward_on_item_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.fulfillment_status is distinct from old.fulfillment_status or new.status is distinct from old.status then
    perform public.sync_gift_reward_from_order(new.order_id);
  end if;
  return new;
end;
$$;

drop trigger if exists sync_gift_reward_on_item_change on public.order_items;
create trigger sync_gift_reward_on_item_change
after update on public.order_items
for each row execute function public.trg_sync_gift_reward_on_item_change();

-- ----------------------------------------------------------------------------
-- Rattrapage immédiat : assigne les cadeaux déjà en attente aux commandes
-- déjà passées, puis synchronise leur statut sur l'état réel de ces
-- commandes.
-- ----------------------------------------------------------------------------
select public.assign_pending_gift_rewards();

do $$
declare
  v_order_id uuid;
begin
  for v_order_id in select distinct assigned_order_id from public.b2b_gift_rewards where assigned_order_id is not null
  loop
    perform public.sync_gift_reward_from_order(v_order_id);
  end loop;
end $$;

notify pgrst, 'reload schema';
