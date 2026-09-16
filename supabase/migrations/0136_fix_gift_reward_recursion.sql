-- ============================================================================
-- URGENT — corrige une boucle infinie ("stack depth limit exceeded") lors
-- du paiement d'une commande B2B par solde portefeuille.
--
-- Root cause : pay_b2b_order_with_wallet (comme submit_b2b_order/
-- confirm_b2b_payment, fonctions non versionnées ici — voir la note sur
-- cart_add_item) fait INSERT INTO orders PUIS INSERT INTO order_items en
-- deux instructions séparées. L'INSERT dans orders déclenche
-- trg_assign_gift_rewards_on_order -> assign_pending_gift_rewards(), qui
-- assigne un cadeau fidélité (b2b_gift_rewards) en attente à la commande
-- tout juste créée, puis appelle sync_gift_reward_from_order(order_id).
--
-- Mais à ce stade, order_items pour cette commande n'existe pas ENCORE
-- (l'INSERT correspondant n'a pas encore eu lieu) — sync_gift_reward_
-- from_order confondait ce cas ("pas encore rempli") avec "tous les
-- articles ont été annulés" (les deux donnent v_min_rank = null), et
-- réagissait en annulant l'assignation puis en rappelant
-- assign_pending_gift_rewards(), qui réassignait le même cadeau à la même
-- commande, qui rappelait sync_gift_reward_from_order, qui retrouvait
-- encore aucun article... boucle infinie tant qu'un cadeau fidélité est en
-- attente au moment précis d'un paiement.
--
-- Fix : distingue explicitement "aucune ligne order_items du tout" (commande
-- tout juste créée, ne rien faire — le prochain changement de
-- fulfillment_status redéclenchera ce sync au bon moment) de "des lignes
-- existent mais aucune n'est active" (véritablement annulée, réassigner le
-- cadeau ailleurs, comportement inchangé).
-- ============================================================================

create or replace function public.sync_gift_reward_from_order(p_order_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_order_status text;
  v_min_rank int;
  v_max_rank int;
  v_ship_ts timestamptz;
  v_has_any_items boolean;
begin
  select status into v_order_status from public.orders where id = p_order_id;
  if v_order_status is null or v_order_status = 'cancelled' then
    return;
  end if;

  select exists(select 1 from public.order_items where order_id = p_order_id) into v_has_any_items;
  if not v_has_any_items then
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

  -- Plus aucun article actif ALORS QU'IL EN EXISTAIT (v_has_any_items) : la
  -- commande n'aboutira jamais (annulée en totalité, item par item ou d'un
  -- coup) — le cadeau qui lui était assigné est reporté à la prochaine
  -- commande éligible de ce même profil plutôt que de rester accroché à une
  -- commande morte.
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
$function$;

notify pgrst, 'reload schema';
