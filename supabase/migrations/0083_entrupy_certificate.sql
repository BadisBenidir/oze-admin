-- ============================================================================
-- Certificat d'authenticité Entrupy (19,99 €/pièce), opt-out par défaut au
-- checkout B2B, ajoutable après coup depuis "Mes commandes" tant que la
-- livraison de l'article n'a pas été demandée.
--
-- Suit exactement le même schéma que insured/insurance_cost sur order_items
-- (0021_b2b_order_insurance.sql) pour l'ajout au checkout, et le même
-- pipeline "Stripe Checkout dédié + webhook finalise en autorité" que
-- b2b-request-delivery-checkout / finalize_b2b_delivery_request
-- (0065/0068) pour l'ajout post-achat — jamais de RPC appelable directement
-- par le client pour marquer un article certifié sans paiement confirmé.
-- ============================================================================

alter table public.order_items add column if not exists entrupy_requested boolean not null default false;
alter table public.order_items add column if not exists entrupy_cost numeric not null default 0;
-- Trace la session Stripe qui a payé un ajout POST-ACHAT (distinct de
-- stripe_session_id sur `orders`, qui couvre le paiement de la commande
-- entière) — sert uniquement à l'idempotence de finalize_entrupy_certificate_
-- request si Stripe livre l'événement webhook plusieurs fois. Toujours null
-- pour un certificat inclus dès le checkout initial (déjà couvert par
-- orders.stripe_session_id).
alter table public.order_items add column if not exists entrupy_stripe_session_id text;
alter table public.orders add column if not exists entrupy_cost numeric not null default 0;

create unique index if not exists order_items_entrupy_stripe_session_id_idx
  on public.order_items (entrupy_stripe_session_id)
  where entrupy_stripe_session_id is not null;

-- ----------------------------------------------------------------------------
-- confirm_b2b_payment : ajoute p_entrupy_product_ids / p_entrupy_cost en fin
-- de signature (paramètres optionnels, n'affecte aucun appelant existant qui
-- ne les fournit pas). Corps repris à l'identique de la version 0060
-- (retire_delivery_batches_auto_assignment) hormis ces ajouts.
-- ----------------------------------------------------------------------------
create or replace function public.confirm_b2b_payment(
  p_reseller_id uuid,
  p_product_ids uuid[],
  p_shipping_address jsonb,
  p_billing_address jsonb,
  p_stripe_session_id text,
  p_stripe_payment_intent_id text,
  p_email text,
  p_placed_by_profile_id uuid default null,
  p_shipping_cost numeric default 0,
  p_insured_product_ids uuid[] default '{}'::uuid[],
  p_insurance_cost numeric default 0,
  p_grouped_with_order_id uuid default null,
  p_insured_value numeric default 0,
  p_discount_rate numeric default 0,
  p_discount_amount numeric default 0,
  p_entrupy_product_ids uuid[] default '{}'::uuid[],
  p_entrupy_cost numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_order_id uuid;
  v_reserved_ids uuid[];
  v_unavailable_ids uuid[];
  v_subtotal numeric;
  v_order_id uuid;
  v_order_number text;
begin
  select id into v_existing_order_id from public.orders where stripe_session_id = p_stripe_session_id;
  if v_existing_order_id is not null then
    return jsonb_build_object('order_id', v_existing_order_id, 'already_processed', true, 'unavailable_ids', '[]'::jsonb);
  end if;

  if p_product_ids is null or array_length(p_product_ids, 1) is null then
    raise exception 'Aucun article dans la commande';
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
    return jsonb_build_object('order_id', null, 'already_processed', false, 'unavailable_ids', to_jsonb(p_product_ids));
  end if;

  select coalesce(sum(p.sale_price), 0) into v_subtotal from public.products p where p.id = any(v_reserved_ids);

  v_order_number := 'B2B-' || to_char(now(), 'YYYYMMDDHH24MISS') || '-' || substr(p_reseller_id::text, 1, 4);

  insert into public.orders (
    order_number, email, status, total_amount, subtotal, shipping_cost, insurance_cost, insured_value,
    discount_rate, discount_amount, entrupy_cost, currency,
    payment_status, shipping_address, billing_address, reseller_id, placed_by_profile_id,
    order_channel, approval_status, approved_at, stripe_session_id, stripe_payment_intent_id,
    grouped_with_order_id
  ) values (
    v_order_number, p_email, 'confirmed',
    v_subtotal - coalesce(p_discount_amount, 0) + coalesce(p_shipping_cost, 0) + coalesce(p_insurance_cost, 0) + coalesce(p_entrupy_cost, 0),
    v_subtotal, coalesce(p_shipping_cost, 0), coalesce(p_insurance_cost, 0), coalesce(p_insured_value, 0),
    coalesce(p_discount_rate, 0), coalesce(p_discount_amount, 0), coalesce(p_entrupy_cost, 0), 'EUR',
    'paid', p_shipping_address, coalesce(p_billing_address, p_shipping_address), p_reseller_id, p_placed_by_profile_id,
    'b2b', 'approved', now(), p_stripe_session_id, p_stripe_payment_intent_id,
    p_grouped_with_order_id
  )
  returning id into v_order_id;

  insert into public.order_items (order_id, product_id, quantity, unit_price, line_total, product_snapshot, insured, insurance_cost, entrupy_requested, entrupy_cost)
  select
    v_order_id, p.id, 1, p.sale_price, p.sale_price, to_jsonb(p.*),
    p.id = any(p_insured_product_ids),
    case when p.id = any(p_insured_product_ids) then round(p.sale_price * 0.006, 2) else 0 end,
    p.id = any(p_entrupy_product_ids),
    case when p.id = any(p_entrupy_product_ids) then 19.99 else 0 end
  from public.products p where p.id = any(v_reserved_ids);

  update public.products set reserved_by_order_id = v_order_id where id = any(v_reserved_ids);

  return jsonb_build_object(
    'order_id', v_order_id, 'already_processed', false, 'subtotal', v_subtotal,
    'unavailable_ids', to_jsonb(coalesce(v_unavailable_ids, array[]::uuid[]))
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- pay_b2b_order_with_wallet : même ajout, corps repris à l'identique de la
-- version 0060.
-- ----------------------------------------------------------------------------
create or replace function public.pay_b2b_order_with_wallet(
  p_reseller_id uuid,
  p_product_ids uuid[],
  p_shipping_address jsonb,
  p_billing_address jsonb,
  p_email text,
  p_placed_by_profile_id uuid,
  p_shipping_cost numeric default 0,
  p_insured_product_ids uuid[] default '{}'::uuid[],
  p_insurance_cost numeric default 0,
  p_grouped_with_order_id uuid default null,
  p_insured_value numeric default 0,
  p_discount_rate numeric default 0,
  p_discount_amount numeric default 0,
  p_promo_discount_amount numeric default 0,
  p_entrupy_product_ids uuid[] default '{}'::uuid[],
  p_entrupy_cost numeric default 0
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
    + coalesce(p_shipping_cost, 0) + coalesce(p_insurance_cost, 0) + coalesce(p_entrupy_cost, 0);

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
    discount_rate, discount_amount, promo_discount_amount, entrupy_cost, currency,
    payment_status, shipping_address, billing_address, reseller_id, placed_by_profile_id,
    order_channel, approval_status, approved_at,
    grouped_with_order_id
  ) values (
    v_order_number, p_email, 'confirmed',
    v_total,
    v_subtotal, coalesce(p_shipping_cost, 0), coalesce(p_insurance_cost, 0), coalesce(p_insured_value, 0),
    coalesce(p_discount_rate, 0), coalesce(p_discount_amount, 0), coalesce(p_promo_discount_amount, 0), coalesce(p_entrupy_cost, 0), 'EUR',
    'paid', p_shipping_address, coalesce(p_billing_address, p_shipping_address), p_reseller_id, p_placed_by_profile_id,
    'b2b', 'approved', now(),
    p_grouped_with_order_id
  )
  returning id into v_order_id;

  insert into public.order_items (order_id, product_id, quantity, unit_price, line_total, product_snapshot, insured, insurance_cost, entrupy_requested, entrupy_cost)
  select
    v_order_id, p.id, 1, p.sale_price, p.sale_price, to_jsonb(p.*),
    p.id = any(p_insured_product_ids),
    case when p.id = any(p_insured_product_ids) then round(p.sale_price * 0.006, 2) else 0 end,
    p.id = any(p_entrupy_product_ids),
    case when p.id = any(p_entrupy_product_ids) then 19.99 else 0 end
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

-- ----------------------------------------------------------------------------
-- finalize_entrupy_certificate_request : ajout POST-ACHAT d'un certificat sur
-- des order_items déjà existants, appelée UNIQUEMENT par b2b-stripe-webhook
-- après paiement Stripe confirmé (jamais par le client — même verrouillage
-- que finalize_b2b_delivery_request, 0068). Idempotente sur
-- entrupy_stripe_session_id.
-- ----------------------------------------------------------------------------
create or replace function public.finalize_entrupy_certificate_request(
  p_item_ids uuid[],
  p_reseller_id uuid,
  p_stripe_session_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_already_id uuid;
  v_eligible_ids uuid[];
  v_price constant numeric := 19.99;
begin
  select id into v_already_id from public.order_items where entrupy_stripe_session_id = p_stripe_session_id limit 1;
  if v_already_id is not null then
    return jsonb_build_object('already_processed', true, 'item_count', 0);
  end if;

  -- Verrouille d'abord les lignes concernées (sans agrégat), puis agrège :
  -- FOR UPDATE ne peut pas cohabiter avec array_agg dans la même requête
  -- (même piège que finalize_b2b_delivery_request, cf. 0068).
  perform 1
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where oi.id = any(p_item_ids)
    and oi.status = 'active'
    and oi.entrupy_requested = false
    and oi.fulfillment_status not in ('delivery_requested', 'shipped')
    and o.order_channel = 'b2b'
    and o.reseller_id = p_reseller_id
  for update of oi;

  select array_agg(oi.id) into v_eligible_ids
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where oi.id = any(p_item_ids)
    and oi.status = 'active'
    and oi.entrupy_requested = false
    and oi.fulfillment_status not in ('delivery_requested', 'shipped')
    and o.order_channel = 'b2b'
    and o.reseller_id = p_reseller_id;

  if v_eligible_ids is null or array_length(v_eligible_ids, 1) <> array_length(p_item_ids, 1) then
    raise exception 'Certains articles ne sont plus éligibles pour un ajout de certificat Entrupy';
  end if;

  update public.order_items
  set entrupy_requested = true,
      entrupy_cost = v_price,
      entrupy_stripe_session_id = p_stripe_session_id
  where id = any(v_eligible_ids);

  -- Répercute sur chaque commande concernée (les articles sélectionnés
  -- peuvent appartenir à plusieurs commandes) : agrégats orders.entrupy_cost
  -- et orders.total_amount, même logique que cancel_b2b_order_item
  -- (0032) pour la cohérence order <-> order_items.
  update public.orders o
  set entrupy_cost = o.entrupy_cost + added.amount,
      total_amount = o.total_amount + added.amount
  from (
    select order_id, count(*) * v_price as amount
    from public.order_items
    where id = any(v_eligible_ids)
    group by order_id
  ) added
  where o.id = added.order_id;

  return jsonb_build_object('already_processed', false, 'item_count', array_length(v_eligible_ids, 1));
end;
$$;

revoke all on function public.finalize_entrupy_certificate_request(uuid[], uuid, text) from public, anon, authenticated;
grant execute on function public.finalize_entrupy_certificate_request(uuid[], uuid, text) to service_role;

notify pgrst, 'reload schema';
