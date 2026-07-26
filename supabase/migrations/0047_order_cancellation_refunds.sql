-- ============================================================================
-- Module B2B Revendeurs — 47 : annulation de commande/articles avec choix du
-- mode de remboursement (portefeuille ou Stripe), + annulation en libre-
-- service côté revendeur (toujours remboursée en portefeuille), + annulation
-- de commande ENTIÈRE (pas seulement article par article).
--
-- Existant réutilisé tel quel : cancel_b2b_order_item (0032) — recalcul de
-- commande, remise en vente du produit. Ce qu'il ne faisait pas : créditer
-- le portefeuille (seul un remboursement Stripe existait, et seulement si
-- payment_status='paid' + stripe_payment_intent_id — donc jamais pour un
-- paiement 100% portefeuille). Étendu ici avec reseller_id/
-- placed_by_profile_id dans son retour, pour que l'Edge Function sache qui
-- créditer sans requête supplémentaire.
-- ============================================================================

alter table public.order_items add column if not exists refund_method text
  check (refund_method is null or refund_method in ('wallet', 'stripe'));
alter table public.order_items add column if not exists refund_error text;

----------------------------------------------------------------------------
-- cancel_b2b_order_item : identique à 0032, + reseller_id/placed_by_profile_id
-- dans le retour (nécessaires pour créditer le bon portefeuille sans requête
-- supplémentaire côté Edge Function).
----------------------------------------------------------------------------
create or replace function public.cancel_b2b_order_item(
  p_order_item_id uuid,
  p_reason text,
  p_restock_action text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item record;
  v_order record;
  v_new_subtotal numeric;
  v_new_insurance numeric;
  v_new_total numeric;
  v_remaining_active integer;
  v_new_order_status text;
begin
  if p_restock_action not in ('draft', 'for-sale-b2b', 'archived') then
    raise exception 'restock_action invalide : %', p_restock_action;
  end if;

  select * into v_item from public.order_items where id = p_order_item_id for update;
  if not found then
    raise exception 'Article de commande introuvable';
  end if;
  if v_item.status = 'cancelled' then
    raise exception 'Cet article est déjà annulé';
  end if;

  select * into v_order from public.orders where id = v_item.order_id for update;
  if not found then
    raise exception 'Commande introuvable';
  end if;

  update public.order_items
  set status = 'cancelled', cancellation_reason = p_reason, cancelled_at = now(), restock_action = p_restock_action
  where id = p_order_item_id;

  select coalesce(sum(line_total), 0), coalesce(sum(case when insured then insurance_cost else 0 end), 0)
  into v_new_subtotal, v_new_insurance
  from public.order_items
  where order_id = v_order.id and status = 'active';

  v_new_total := v_new_subtotal - coalesce(v_order.discount_amount, 0) + coalesce(v_order.shipping_cost, 0) + v_new_insurance;

  select count(*) into v_remaining_active from public.order_items where order_id = v_order.id and status = 'active';
  v_new_order_status := case when v_remaining_active = 0 then 'cancelled' else v_order.status end;

  update public.orders
  set subtotal = v_new_subtotal,
      insurance_cost = v_new_insurance,
      total_amount = v_new_total,
      status = v_new_order_status
  where id = v_order.id;

  update public.products
  set status = p_restock_action,
      reserved_by_reseller_id = null,
      reserved_by_order_id = null,
      reserved_at = null
  where id = v_item.product_id;

  return jsonb_build_object(
    'order_id', v_order.id,
    'order_item_id', p_order_item_id,
    'line_total', v_item.line_total,
    'new_total_amount', v_new_total,
    'order_status', v_new_order_status,
    'payment_status', v_order.payment_status,
    'stripe_payment_intent_id', v_order.stripe_payment_intent_id,
    'reseller_id', v_order.reseller_id,
    'placed_by_profile_id', v_order.placed_by_profile_id
  );
end;
$$;

revoke all on function public.cancel_b2b_order_item(uuid, text, text) from public, anon, authenticated;

----------------------------------------------------------------------------
-- cancel_b2b_order : annule TOUS les articles actifs d'une commande en une
-- transaction (même effet que cancel_b2b_order_item appelée en boucle, mais
-- un seul recalcul de commande à la fin plutôt qu'un par article). Renvoie
-- le montant total à rembourser et la liste des order_item_id annulés, pour
-- que l'Edge Function fasse UN SEUL remboursement (Stripe ou portefeuille)
-- pour la commande entière plutôt qu'un par article.
----------------------------------------------------------------------------
create or replace function public.cancel_b2b_order(
  p_order_id uuid,
  p_reason text,
  p_restock_action text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_total_refund numeric := 0;
  v_cancelled_item_ids uuid[] := '{}';
  v_item record;
begin
  if p_restock_action not in ('draft', 'for-sale-b2b', 'archived') then
    raise exception 'restock_action invalide : %', p_restock_action;
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Commande introuvable';
  end if;

  for v_item in
    select * from public.order_items where order_id = p_order_id and status = 'active' for update
  loop
    update public.order_items
    set status = 'cancelled', cancellation_reason = p_reason, cancelled_at = now(), restock_action = p_restock_action
    where id = v_item.id;

    update public.products
    set status = p_restock_action,
        reserved_by_reseller_id = null,
        reserved_by_order_id = null,
        reserved_at = null
    where id = v_item.product_id;

    v_total_refund := v_total_refund + v_item.line_total;
    v_cancelled_item_ids := v_cancelled_item_ids || v_item.id;
  end loop;

  if array_length(v_cancelled_item_ids, 1) is null then
    raise exception 'Aucun article actif à annuler sur cette commande';
  end if;

  -- Même formule que cancel_b2b_order_item pour rester cohérent avec le cas
  -- "tous les articles annulés un par un" : subtotal/insurance retombent à
  -- 0, mais la remise/livraison restent dans le calcul du total affiché.
  update public.orders
  set subtotal = 0,
      insurance_cost = 0,
      total_amount = 0 - coalesce(v_order.discount_amount, 0) + coalesce(v_order.shipping_cost, 0),
      status = 'cancelled'
  where id = p_order_id;

  return jsonb_build_object(
    'order_id', p_order_id,
    'order_item_ids', to_jsonb(v_cancelled_item_ids),
    'total_refund', v_total_refund,
    'payment_status', v_order.payment_status,
    'stripe_payment_intent_id', v_order.stripe_payment_intent_id,
    'reseller_id', v_order.reseller_id,
    'placed_by_profile_id', v_order.placed_by_profile_id
  );
end;
$$;

revoke all on function public.cancel_b2b_order(uuid, text, text) from public, anon, authenticated;

----------------------------------------------------------------------------
-- credit_order_item_refund_to_wallet : crédite le portefeuille du profil
-- indiqué (le payeur d'origine de la commande, `placed_by_profile_id`,
-- jamais celui qui clique sur "Annuler" — un coéquipier peut annuler une
-- commande payée par un autre) et journalise un `wallet_transactions` de
-- type 'remboursement' rattaché à la commande. Service-role uniquement.
----------------------------------------------------------------------------
create or replace function public.credit_order_item_refund_to_wallet(
  p_profile_id uuid,
  p_reseller_id uuid,
  p_amount numeric,
  p_order_id uuid,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_balance numeric;
  v_transaction_id uuid;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Montant de remboursement invalide';
  end if;

  update public.profiles
  set wallet_balance = wallet_balance + p_amount
  where id = p_profile_id
  returning wallet_balance into v_new_balance;

  if not found then
    raise exception 'Profil introuvable : %', p_profile_id;
  end if;

  insert into public.wallet_transactions (profile_id, reseller_id, amount, type, status, order_id, note)
  values (p_profile_id, p_reseller_id, p_amount, 'remboursement', 'success', p_order_id, p_note)
  returning id into v_transaction_id;

  return jsonb_build_object('new_balance', v_new_balance, 'transaction_id', v_transaction_id);
end;
$$;

revoke all on function public.credit_order_item_refund_to_wallet(uuid, uuid, numeric, uuid, text) from public, anon, authenticated;

notify pgrst, 'reload schema';
