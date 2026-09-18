-- ============================================================================
-- Paiement sous 24h des lots d'enchère adjugés, dans un espace dédié de la
-- page "Enchères" côté revendeur.
--
-- Jusqu'ici, la clôture d'une session (admin_close_auction_session, 0105)
-- classait chaque lot 'sold'/'unsold' mais ne créait AUCUNE commande — il
-- fallait un second geste admin manuel (admin_generate_order_from_auction_item)
-- pour matérialiser une commande à payer, et rien côté revendeur n'affichait
-- jamais "vous avez gagné, payez maintenant" : un lot 'sold' n'affichait
-- qu'un badge "Vendu" sans action possible (Auctions.tsx/AuctionItemDetail
-- Modal.tsx).
--
-- Cette migration :
--   1. Ajoute auction_items.order_id (lien vers la commande générée) et
--      payment_deadline (échéance de 24h).
--   2. admin_close_auction_session génère désormais AUTOMATIQUEMENT la
--      commande de chaque lot adjugé (au lieu du seul geste manuel), en
--      best-effort par lot — une pièce sans fiche produit liée échoue
--      silencieusement et reste gérable à la main (bouton "Générer la
--      commande" déjà existant dans AuctionsAdmin.tsx, conservé tel quel).
--   3. Deux nouvelles RPC reseller-facing : get_my_pending_auction_payments
--      (liste ses lots gagnés non payés) et pay_auction_order_with_wallet
--      (débit direct du solde — AUCUN bonus de recharge, puisque ça ne passe
--      jamais par credit_wallet_topup, qui est le seul endroit où le bonus
--      existe).
--   4. confirm_auction_order_payment (service-role uniquement) : finalise le
--      paiement carte, appelée par b2b-stripe-webhook.
--
-- Le dépassement du délai de 24h n'est PAS automatisé ici (pas d'annulation
-- ni de remise en vente auto) : uniquement un signalement visuel côté admin
-- (AuctionsAdmin.tsx), qui décide au cas par cas.
-- ============================================================================

alter table public.auction_items
  add column if not exists order_id uuid references public.orders (id) on delete set null,
  add column if not exists payment_deadline timestamptz;

comment on column public.auction_items.payment_deadline is
  'Échéance de paiement (24h après adjudication) — signalement admin uniquement si dépassée, aucune annulation automatique.';

-- ----------------------------------------------------------------------------
-- admin_generate_order_from_auction_item (0105) : identique, avec en plus la
-- liaison auction_items.order_id -> orders.id une fois la commande créée,
-- nécessaire pour que get_my_pending_auction_payments retrouve le lot.
-- ----------------------------------------------------------------------------
create or replace function public.admin_generate_order_from_auction_item(p_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item record;
  v_product record;
  v_reseller_id uuid;
  v_email text;
  v_order_id uuid;
  v_order_number text;
begin
  if not public.is_admin() then
    raise exception 'Accès refusé';
  end if;

  select * into v_item from public.auction_items where id = p_item_id for update;
  if v_item is null then
    raise exception 'Lot introuvable';
  end if;
  if v_item.status <> 'sold' then
    raise exception 'Ce lot n''a pas été adjugé';
  end if;
  if v_item.current_winner_id is null then
    raise exception 'Aucun gagnant pour ce lot';
  end if;
  if v_item.product_id is null then
    raise exception 'Cette pièce n''est liée à aucune fiche produit — liez-en une avant de générer la commande';
  end if;

  select * into v_product from public.products where id = v_item.product_id for update;
  if v_product is null then
    raise exception 'Fiche produit introuvable';
  end if;
  if v_product.status <> 'draft' then
    raise exception 'Ce produit n''est plus disponible (déjà vendu ailleurs)';
  end if;

  select rc.reseller_id into v_reseller_id from public.reseller_contacts rc where rc.profile_id = v_item.current_winner_id limit 1;
  if v_reseller_id is null then
    raise exception 'Revendeur introuvable pour ce gagnant';
  end if;
  select email into v_email from public.profiles where id = v_item.current_winner_id;

  v_order_number := 'AUC-' || to_char(now(), 'YYYYMMDDHH24MISS') || '-' || substr(v_item.id::text, 1, 4);

  insert into public.orders (
    order_number, email, status, total_amount, subtotal, shipping_cost, currency,
    payment_status, reseller_id, placed_by_profile_id,
    order_channel, approval_status, approved_at
  ) values (
    v_order_number, v_email, 'confirmed', v_item.current_price, v_item.current_price, 0, 'EUR',
    'pending', v_reseller_id, v_item.current_winner_id,
    'b2b', 'approved', now()
  )
  returning id into v_order_id;

  insert into public.order_items (order_id, product_id, quantity, unit_price, line_total, product_snapshot)
  values (v_order_id, v_product.id, 1, v_item.current_price, v_item.current_price, to_jsonb(v_product));

  update public.products
  set status = 'sold-b2b', reserved_by_reseller_id = v_reseller_id, reserved_by_order_id = v_order_id, reserved_at = now()
  where id = v_product.id;

  update public.auction_items set order_id = v_order_id where id = p_item_id;

  return jsonb_build_object('order_id', v_order_id, 'order_number', v_order_number);
end;
$$;

-- ----------------------------------------------------------------------------
-- admin_close_auction_session (0105) : pose désormais l'échéance de 24h sur
-- chaque lot adjugé et tente de générer sa commande automatiquement,
-- best-effort lot par lot (une erreur sur un lot — ex: pas de fiche produit
-- liée — n'empêche jamais la clôture des autres ni de la session).
-- ----------------------------------------------------------------------------
create or replace function public.admin_close_auction_session(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item_id uuid;
  v_orders_created int := 0;
  v_orders_failed int := 0;
begin
  if not public.is_admin() then
    raise exception 'Accès refusé';
  end if;

  update public.auction_items
  set
    status = case
      when current_winner_id is not null and (reserve_price is null or current_price >= reserve_price) then 'sold'
      else 'unsold'
    end,
    payment_deadline = case
      when current_winner_id is not null and (reserve_price is null or current_price >= reserve_price) then now() + interval '24 hours'
      else payment_deadline
    end
  where session_id = p_session_id and status = 'active';

  for v_item_id in
    select id from public.auction_items
    where session_id = p_session_id and status = 'sold' and order_id is null
  loop
    begin
      perform public.admin_generate_order_from_auction_item(v_item_id);
      v_orders_created := v_orders_created + 1;
    exception when others then
      -- Best-effort : reste "Générer la commande" manuel côté admin
      -- (AuctionsAdmin.tsx) pour ce lot précis, sans bloquer les autres.
      v_orders_failed := v_orders_failed + 1;
    end;
  end loop;

  update public.auction_sessions set status = 'closed' where id = p_session_id;

  return jsonb_build_object('session_id', p_session_id, 'orders_created', v_orders_created, 'orders_failed', v_orders_failed);
end;
$$;

grant execute on function public.admin_close_auction_session(uuid) to authenticated;
grant execute on function public.admin_generate_order_from_auction_item(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- get_my_pending_auction_payments : lots gagnés par le profil connecté dont
-- la commande générée n'est pas encore payée.
-- ----------------------------------------------------------------------------
create or replace function public.get_my_pending_auction_payments()
returns table (
  item_id uuid,
  title text,
  brand text,
  images text[],
  order_id uuid,
  order_number text,
  amount numeric,
  payment_deadline timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select ai.id, ai.title, ai.brand, ai.images, o.id, o.order_number, o.total_amount, ai.payment_deadline
  from public.auction_items ai
  join public.orders o on o.id = ai.order_id
  where ai.current_winner_id = auth.uid()
    and o.payment_status = 'pending'
  order by ai.payment_deadline asc nulls last;
$$;

grant execute on function public.get_my_pending_auction_payments() to authenticated;

-- ----------------------------------------------------------------------------
-- pay_auction_order_with_wallet : débit DIRECT du solde (jamais via
-- credit_wallet_topup, donc jamais de bonus de recharge) pour finaliser le
-- paiement d'un lot d'enchère déjà adjugé.
-- ----------------------------------------------------------------------------
create or replace function public.pay_auction_order_with_wallet(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_balance numeric;
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

grant execute on function public.pay_auction_order_with_wallet(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- confirm_auction_order_payment : finalise un paiement carte, appelée
-- uniquement par b2b-stripe-webhook (service_role) après paiement Stripe
-- confirmé — jamais accessible au client.
-- ----------------------------------------------------------------------------
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
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order is null then
    raise exception 'Commande introuvable';
  end if;
  if v_order.payment_status = 'paid' then
    return jsonb_build_object('already_processed', true, 'order_id', p_order_id);
  end if;

  update public.orders
  set payment_status = 'paid', stripe_session_id = p_stripe_session_id, stripe_payment_intent_id = p_stripe_payment_intent_id
  where id = p_order_id;

  return jsonb_build_object('already_processed', false, 'order_id', p_order_id);
end;
$$;

revoke all on function public.confirm_auction_order_payment(uuid, text, text) from public, authenticated;

notify pgrst, 'reload schema';
