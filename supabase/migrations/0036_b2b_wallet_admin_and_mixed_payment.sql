-- ============================================================================
-- Module B2B Revendeurs — 36 : ajustement admin du solde + paiement mixte
-- (solde + carte) au checkout.
--
-- 1. Ajustement manuel admin : nouveau type 'ajustement_admin', montant
--    signé (positif = crédit, négatif = retrait) car un ajustement admin
--    peut aller dans les deux sens, contrairement aux autres types déjà en
--    place (toujours positifs, le sens est déterminé par `type`).
--
-- 2. Paiement mixte : le solde ne couvre pas la totalité de la commande. On
--    débite la part couverte par le solde IMMÉDIATEMENT et atomiquement
--    (debit_wallet_amount, transaction 'pending' liée au futur
--    stripe_session_id), Stripe ne facture que le reste. Si le paiement
--    Stripe aboutit, finalize_wallet_order_debit rattache la transaction à
--    la commande et corrige son total_amount (confirm_b2b_payment ne connaît
--    que la part payée par carte). Si la session Stripe expire sans
--    paiement (événement `checkout.session.expired`, à activer manuellement
--    dans le dashboard Stripe comme les autres événements de ce webhook),
--    refund_pending_wallet_debit recrédite le solde débité pour rien.
-- ============================================================================

alter table public.wallet_transactions add column if not exists note text;
alter table public.wallet_transactions add column if not exists created_by uuid references public.profiles (id);

alter table public.wallet_transactions drop constraint if exists wallet_transactions_type_check;
alter table public.wallet_transactions add constraint wallet_transactions_type_check
  check (type in ('rechargement', 'achat', 'remboursement', 'ajustement_admin'));

-- Un ajustement admin peut être négatif (retrait) ; tous les autres types
-- restent des montants positifs (le sens vient de `type`, cf. WalletPage.tsx).
alter table public.wallet_transactions drop constraint if exists wallet_transactions_amount_check;
alter table public.wallet_transactions add constraint wallet_transactions_amount_check check (amount <> 0);

-- 'pending' est déjà une valeur autorisée par status ; on ajoute juste un
-- index pour retrouver rapidement une transaction en attente par session.
create index if not exists wallet_transactions_stripe_session_id_idx on public.wallet_transactions (stripe_session_id);

----------------------------------------------------------------------------
-- admin_adjust_wallet_balance : crédit/débit manuel, réservé aux admins.
-- Empêche un solde négatif (retrait plafonné au solde disponible) plutôt que
-- de laisser la contrainte profiles.wallet_balance >= 0 échouer bruta.
----------------------------------------------------------------------------
create or replace function public.admin_adjust_wallet_balance(
  p_profile_id uuid,
  p_amount numeric,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reseller_id uuid;
  v_balance numeric;
  v_tx_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Action réservée aux administrateurs';
  end if;
  if p_amount = 0 then
    raise exception 'Le montant de l''ajustement ne peut pas être nul';
  end if;
  if p_note is null or trim(p_note) = '' then
    raise exception 'Une note explicative est requise pour tout ajustement manuel';
  end if;

  select wallet_balance into v_balance from public.profiles where id = p_profile_id for update;
  if v_balance is null then
    raise exception 'Profil introuvable';
  end if;
  if v_balance + p_amount < 0 then
    raise exception 'Le retrait dépasse le solde disponible (% €)', v_balance;
  end if;

  select rc.reseller_id into v_reseller_id from public.reseller_contacts rc where rc.profile_id = p_profile_id;
  if v_reseller_id is null then
    raise exception 'Ce profil n''est rattaché à aucune société revendeuse';
  end if;

  update public.profiles set wallet_balance = wallet_balance + p_amount where id = p_profile_id;

  insert into public.wallet_transactions (profile_id, reseller_id, amount, type, status, note, created_by)
  values (p_profile_id, v_reseller_id, p_amount, 'ajustement_admin', 'success', p_note, auth.uid())
  returning id into v_tx_id;

  return jsonb_build_object('transaction_id', v_tx_id, 'new_balance', v_balance + p_amount);
end;
$$;

revoke all on function public.admin_adjust_wallet_balance(uuid, numeric, text) from public, authenticated;
grant execute on function public.admin_adjust_wallet_balance(uuid, numeric, text) to authenticated;

----------------------------------------------------------------------------
-- debit_wallet_amount : débit immédiat de la part "solde" d'un paiement
-- mixte, avant même la création de la session Stripe pour le reste. Lié au
-- stripe_session_id (posé juste après par b2b-checkout) pour permettre la
-- finalisation ou le remboursement selon l'issue du paiement Stripe.
----------------------------------------------------------------------------
create or replace function public.debit_wallet_amount(
  p_profile_id uuid,
  p_reseller_id uuid,
  p_amount numeric,
  p_stripe_session_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric;
  v_tx_id uuid;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Montant de débit invalide';
  end if;

  select wallet_balance into v_balance from public.profiles where id = p_profile_id for update;
  if v_balance is null then
    raise exception 'Profil introuvable';
  end if;
  if v_balance < p_amount then
    raise exception 'Solde insuffisant';
  end if;

  update public.profiles set wallet_balance = wallet_balance - p_amount where id = p_profile_id;

  insert into public.wallet_transactions (profile_id, reseller_id, amount, type, status, stripe_session_id)
  values (p_profile_id, p_reseller_id, p_amount, 'achat', 'pending', p_stripe_session_id)
  returning id into v_tx_id;

  return jsonb_build_object('transaction_id', v_tx_id);
end;
$$;

revoke all on function public.debit_wallet_amount(uuid, uuid, numeric, text) from public, authenticated;

----------------------------------------------------------------------------
-- finalize_wallet_order_debit : appelée par le webhook une fois la commande
-- créée (confirm_b2b_payment) pour un paiement mixte payé avec succès —
-- rattache la transaction 'pending' à la commande et corrige total_amount
-- (confirm_b2b_payment ne facture/connaît que la part carte).
----------------------------------------------------------------------------
create or replace function public.finalize_wallet_order_debit(
  p_stripe_session_id text,
  p_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx record;
begin
  select * into v_tx from public.wallet_transactions
  where stripe_session_id = p_stripe_session_id and status = 'pending'
  for update;

  if not found then
    return jsonb_build_object('found', false);
  end if;

  update public.wallet_transactions set status = 'success', order_id = p_order_id where id = v_tx.id;
  update public.orders set total_amount = total_amount + v_tx.amount where id = p_order_id;

  return jsonb_build_object('found', true, 'amount', v_tx.amount);
end;
$$;

revoke all on function public.finalize_wallet_order_debit(text, uuid) from public, authenticated;

----------------------------------------------------------------------------
-- refund_pending_wallet_debit : appelée sur `checkout.session.expired` —
-- recrédite le solde si la session n'a finalement jamais été payée.
----------------------------------------------------------------------------
create or replace function public.refund_pending_wallet_debit(
  p_stripe_session_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx record;
begin
  select * into v_tx from public.wallet_transactions
  where stripe_session_id = p_stripe_session_id and status = 'pending'
  for update;

  if not found then
    return jsonb_build_object('found', false);
  end if;

  update public.profiles set wallet_balance = wallet_balance + v_tx.amount where id = v_tx.profile_id;
  update public.wallet_transactions set status = 'failed' where id = v_tx.id;

  return jsonb_build_object('found', true, 'amount', v_tx.amount);
end;
$$;

revoke all on function public.refund_pending_wallet_debit(text) from public, authenticated;

----------------------------------------------------------------------------
-- pay_b2b_order_with_wallet : ajoute le support du code promo (inexistant
-- au moment où cette fonction a été écrite). DROP explicite de l'ancienne
-- signature avant recréation — un simple CREATE OR REPLACE avec une liste
-- de paramètres différente crée un SURCHARGE au lieu de remplacer, exactement
-- l'incident déjà rencontré sur confirm_b2b_payment (voir
-- 0027_b2b_confirm_payment_consolidated.sql) : PostgREST se retrouverait
-- avec deux signatures possibles pour le même nom de fonction.
----------------------------------------------------------------------------
drop function if exists public.pay_b2b_order_with_wallet(uuid, uuid[], jsonb, jsonb, text, uuid, numeric, uuid[], numeric, uuid, numeric, numeric, numeric);

create function public.pay_b2b_order_with_wallet(
  p_reseller_id uuid,
  p_product_ids uuid[],
  p_shipping_address jsonb,
  p_billing_address jsonb,
  p_email text,
  p_placed_by_profile_id uuid,
  p_shipping_cost numeric default 0,
  p_insured_product_ids uuid[] default '{}',
  p_insurance_cost numeric default 0,
  p_grouped_with_order_id uuid default null,
  p_insured_value numeric default 0,
  p_discount_rate numeric default 0,
  p_discount_amount numeric default 0,
  p_promo_discount_amount numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric;
  v_reserved_ids uuid[];
  v_unavailable_ids uuid[];
  v_subtotal numeric;
  v_total numeric;
  v_order_id uuid;
  v_order_number text;
  v_tx_id uuid;
begin
  if p_product_ids is null or array_length(p_product_ids, 1) is null then
    raise exception 'Aucun article dans la commande';
  end if;

  -- Verrou de ligne : sérialise les appels concurrents sur ce même profil.
  select wallet_balance into v_balance from public.profiles where id = p_placed_by_profile_id for update;
  if v_balance is null then
    raise exception 'Profil introuvable';
  end if;

  with reserved as (
    update public.products
    set status = 'sold-b2b', reserved_by_reseller_id = p_reseller_id, reserved_at = now()
    where id = any(p_product_ids) and status = 'for-sale-b2b'
    returning id
  )
  select array_agg(id) into v_reserved_ids from reserved;

  select array_agg(pid) into v_unavailable_ids
  from unnest(p_product_ids) as pid
  where pid <> all (coalesce(v_reserved_ids, array[]::uuid[]));

  if v_reserved_ids is null or array_length(v_reserved_ids, 1) is null then
    return jsonb_build_object('order_id', null, 'unavailable_ids', to_jsonb(p_product_ids));
  end if;

  select coalesce(sum(p.sale_price), 0) into v_subtotal from public.products p where p.id = any(v_reserved_ids);

  v_total := v_subtotal - coalesce(p_discount_amount, 0) - coalesce(p_promo_discount_amount, 0)
    + coalesce(p_shipping_cost, 0) + coalesce(p_insurance_cost, 0);

  if v_balance < v_total then
    -- Libère la réservation posée ci-dessus avant d'échouer : sinon les
    -- articles resteraient bloqués "sold-b2b" pour une commande qui n'aura
    -- jamais lieu.
    update public.products set status = 'for-sale-b2b', reserved_by_reseller_id = null, reserved_at = null
    where id = any(v_reserved_ids);
    raise exception 'Solde insuffisant';
  end if;

  update public.profiles set wallet_balance = wallet_balance - v_total where id = p_placed_by_profile_id;

  v_order_number := 'B2B-' || to_char(now(), 'YYYYMMDDHH24MISS') || '-' || substr(p_reseller_id::text, 1, 4);

  insert into public.orders (
    order_number, email, status, total_amount, subtotal, shipping_cost, insurance_cost, insured_value,
    discount_rate, discount_amount, promo_discount_amount, currency,
    payment_status, shipping_address, billing_address, reseller_id, placed_by_profile_id,
    order_channel, approval_status, approved_at,
    grouped_with_order_id
  ) values (
    v_order_number, p_email, 'confirmed',
    v_total,
    v_subtotal, coalesce(p_shipping_cost, 0), coalesce(p_insurance_cost, 0), coalesce(p_insured_value, 0),
    coalesce(p_discount_rate, 0), coalesce(p_discount_amount, 0), coalesce(p_promo_discount_amount, 0), 'EUR',
    'paid', p_shipping_address, coalesce(p_billing_address, p_shipping_address), p_reseller_id, p_placed_by_profile_id,
    'b2b', 'approved', now(),
    p_grouped_with_order_id
  )
  returning id into v_order_id;

  insert into public.order_items (order_id, product_id, quantity, unit_price, line_total, product_snapshot, insured, insurance_cost)
  select
    v_order_id, p.id, 1, p.sale_price, p.sale_price, to_jsonb(p.*),
    p.id = any(p_insured_product_ids),
    case when p.id = any(p_insured_product_ids) then round(p.sale_price * 0.006, 2) else 0 end
  from public.products p where p.id = any(v_reserved_ids);

  update public.products set reserved_by_order_id = v_order_id where id = any(v_reserved_ids);

  insert into public.wallet_transactions (profile_id, reseller_id, amount, type, status, order_id)
  values (p_placed_by_profile_id, p_reseller_id, v_total, 'achat', 'success', v_order_id)
  returning id into v_tx_id;

  return jsonb_build_object(
    'order_id', v_order_id, 'subtotal', v_subtotal, 'total', v_total,
    'unavailable_ids', to_jsonb(coalesce(v_unavailable_ids, array[]::uuid[]))
  );
end;
$$;

revoke all on function public.pay_b2b_order_with_wallet(uuid, uuid[], jsonb, jsonb, text, uuid, numeric, uuid[], numeric, uuid, numeric, numeric, numeric, numeric) from public, authenticated;

notify pgrst, 'reload schema';
