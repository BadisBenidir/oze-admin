-- ============================================================================
-- Empêche de payer une commande d'enchère tant que le lot n'a pas été
-- réellement adjugé (auction_items.status = 'sold').
--
-- Jusqu'ici, pay_auction_order_with_wallet et confirm_auction_order_payment
-- (0137) vérifiaient seulement la propriété de la commande et son
-- payment_status — jamais l'état réel du lot d'enchère qui l'a générée. Avec
-- le bug corrigé en 0143 (execute_due_auction_sessions adjugeait des lots
-- encore en pleine prolongation anti-snipe), une commande a pu être générée
-- pour un lot pas vraiment terminé ; rien n'empêchait alors le revendeur de
-- la payer immédiatement. Ajoute une garde explicite : la commande doit être
-- liée à un auction_items.status = 'sold' pour être payable, quel que soit
-- le moyen de paiement.
-- ============================================================================

create or replace function public.pay_auction_order_with_wallet(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_balance numeric;
  v_item_status text;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order is null then
    raise exception 'Commande introuvable';
  end if;
  if v_order.placed_by_profile_id <> auth.uid() then
    raise exception 'Cette commande ne vous appartient pas';
  end if;
  if v_order.order_channel <> 'b2b' then
    raise exception 'Commande invalide';
  end if;
  if v_order.payment_status = 'paid' then
    return jsonb_build_object('already_paid', true, 'order_id', p_order_id);
  end if;

  select status into v_item_status from public.auction_items where order_id = p_order_id;
  if v_item_status is distinct from 'sold' then
    raise exception 'Ce lot n''a pas encore été adjugé — paiement impossible pour le moment';
  end if;

  select wallet_balance into v_balance from public.profiles where id = auth.uid() for update;
  if v_balance is null or v_balance < v_order.total_amount then
    raise exception 'Solde insuffisant';
  end if;

  update public.profiles set wallet_balance = wallet_balance - v_order.total_amount where id = auth.uid();
  update public.orders set payment_status = 'paid' where id = p_order_id;

  insert into public.wallet_transactions (profile_id, reseller_id, amount, type, status, order_id)
  values (auth.uid(), v_order.reseller_id, v_order.total_amount, 'achat', 'success', p_order_id);

  return jsonb_build_object('already_paid', false, 'order_id', p_order_id);
end;
$$;

create or replace function public.confirm_auction_order_payment(
  p_order_id uuid,
  p_stripe_session_id text,
  p_stripe_payment_intent_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_item_status text;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order is null then
    raise exception 'Commande introuvable';
  end if;
  if v_order.payment_status = 'paid' then
    return jsonb_build_object('already_processed', true, 'order_id', p_order_id);
  end if;

  -- Ne devrait normalement jamais se déclencher : auction-order-payment
  -- refuse déjà de créer la session Stripe pour un lot non adjugé. Si ça
  -- arrive quand même (lot dé-adjugé entre la création de la session
  -- Stripe et son paiement effectif), le paiement Stripe a déjà eu lieu
  -- côté client — laisse la commande 'pending' pour traitement manuel
  -- (remboursement ou adjudication à confirmer) plutôt que de la marquer
  -- payée sur un lot invalide.
  select status into v_item_status from public.auction_items where order_id = p_order_id;
  if v_item_status is distinct from 'sold' then
    raise exception 'Ce lot n''est pas (ou plus) adjugé — paiement Stripe reçu mais commande laissée en attente, à traiter manuellement';
  end if;

  update public.orders
  set payment_status = 'paid', stripe_session_id = p_stripe_session_id, stripe_payment_intent_id = p_stripe_payment_intent_id
  where id = p_order_id;

  return jsonb_build_object('already_processed', false, 'order_id', p_order_id);
end;
$$;

notify pgrst, 'reload schema';
