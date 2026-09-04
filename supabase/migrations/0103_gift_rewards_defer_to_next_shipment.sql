-- ============================================================================
-- Report d'un portefeuille offert à la prochaine livraison :
--   1. Automatique — si la commande à laquelle un cadeau est assigné finit
--      par n'avoir plus aucun article actif (annulation totale, item par
--      item ou via cancel_b2b_order — les deux passent par le même chemin :
--      order_items.status -> 'cancelled'), le cadeau est détaché et remis
--      en attente, puis une réassignation est retentée immédiatement — sans
--      risque de retomber sur la même commande, structurellement exclue
--      (assign_pending_gift_rewards ne considère que status <> 'cancelled').
--   2. Manuel — nouveau bouton admin "Renvoyer à la prochaine livraison"
--      depuis le rappel 🎁 affiché sur une commande en préparation (retard
--      d'acheminement du portefeuille, décision de l'admin) : détache le
--      cadeau SANS tenter de le réassigner tout de suite, pour ne pas le
--      faire retomber instantanément sur la même commande encore éligible —
--      il attend une commande future (prochain trigger d'insertion) ou une
--      assignation manuelle explicite à une autre commande.
-- ============================================================================

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

  -- Plus aucun article actif : la commande n'aboutira jamais (annulée en
  -- totalité, item par item ou d'un coup) — le cadeau qui lui était assigné
  -- est reporté à la prochaine commande éligible de ce même profil plutôt
  -- que de rester accroché à une commande morte.
  if v_min_rank is null then
    update public.b2b_gift_rewards
    set status = 'pending', assigned_order_id = null
    where assigned_order_id = p_order_id and status <> 'shipped';
    perform public.assign_pending_gift_rewards();
    return;
  end if;

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
-- Report manuel — bouton "Renvoyer à la prochaine livraison".
-- ----------------------------------------------------------------------------
create or replace function public.defer_gift_reward_to_next_shipment(p_gift_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gift record;
begin
  if not public.is_admin() then
    raise exception 'Accès refusé';
  end if;

  select * into v_gift from public.b2b_gift_rewards where id = p_gift_id for update;
  if v_gift is null then
    raise exception 'Portefeuille offert introuvable';
  end if;
  if v_gift.status = 'shipped' then
    raise exception 'Ce portefeuille a déjà été envoyé';
  end if;

  update public.b2b_gift_rewards
  set status = 'pending', assigned_order_id = null
  where id = p_gift_id;

  return jsonb_build_object('gift_id', p_gift_id);
end;
$$;

grant execute on function public.defer_gift_reward_to_next_shipment(uuid) to authenticated;

-- Retente immédiatement la synchro sur les commandes déjà entièrement
-- annulées mais qui gardaient un cadeau accroché avant ce correctif.
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
