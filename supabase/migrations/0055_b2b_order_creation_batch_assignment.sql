-- ============================================================================
-- Rattache automatiquement chaque nouvelle commande B2B payée au lot de
-- livraison 'open' du revendeur (le crée si besoin) — voir
-- 0054_delivery_batches.sql. Modification chirurgicale : le corps de chaque
-- fonction est repris à l'identique (confirmé via pg_get_functiondef avant
-- écriture), seule l'assignation batch_id est ajoutée, pour ne pas risquer de
-- perdre la logique existante (remises, assurance, code promo, paiement
-- mixte...).
-- ============================================================================

create or replace function public.confirm_b2b_payment(p_reseller_id uuid, p_product_ids uuid[], p_shipping_address jsonb, p_billing_address jsonb, p_stripe_session_id text, p_stripe_payment_intent_id text, p_email text, p_placed_by_profile_id uuid DEFAULT NULL::uuid, p_shipping_cost numeric DEFAULT 0, p_insured_product_ids uuid[] DEFAULT '{}'::uuid[], p_insurance_cost numeric DEFAULT 0, p_grouped_with_order_id uuid DEFAULT NULL::uuid, p_insured_value numeric DEFAULT 0, p_discount_rate numeric DEFAULT 0, p_discount_amount numeric DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_existing_order_id uuid;
  v_reserved_ids uuid[];
  v_unavailable_ids uuid[];
  v_subtotal numeric;
  v_order_id uuid;
  v_order_number text;
  v_batch_id uuid;
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

  v_batch_id := public.get_or_create_open_batch(p_reseller_id);

  insert into public.orders (
    order_number, email, status, total_amount, subtotal, shipping_cost, insurance_cost, insured_value,
    discount_rate, discount_amount, currency,
    payment_status, shipping_address, billing_address, reseller_id, placed_by_profile_id,
    order_channel, approval_status, approved_at, stripe_session_id, stripe_payment_intent_id,
    grouped_with_order_id, batch_id
  ) values (
    v_order_number, p_email, 'confirmed',
    v_subtotal - coalesce(p_discount_amount, 0) + coalesce(p_shipping_cost, 0) + coalesce(p_insurance_cost, 0),
    v_subtotal, coalesce(p_shipping_cost, 0), coalesce(p_insurance_cost, 0), coalesce(p_insured_value, 0),
    coalesce(p_discount_rate, 0), coalesce(p_discount_amount, 0), 'EUR',
    'paid', p_shipping_address, coalesce(p_billing_address, p_shipping_address), p_reseller_id, p_placed_by_profile_id,
    'b2b', 'approved', now(), p_stripe_session_id, p_stripe_payment_intent_id,
    p_grouped_with_order_id, v_batch_id
  )
  returning id into v_order_id;

  insert into public.order_items (order_id, product_id, quantity, unit_price, line_total, product_snapshot, insured, insurance_cost)
  select
    v_order_id, p.id, 1, p.sale_price, p.sale_price, to_jsonb(p.*),
    p.id = any(p_insured_product_ids),
    case when p.id = any(p_insured_product_ids) then round(p.sale_price * 0.006, 2) else 0 end
  from public.products p where p.id = any(v_reserved_ids);

  update public.products set reserved_by_order_id = v_order_id where id = any(v_reserved_ids);

  return jsonb_build_object(
    'order_id', v_order_id, 'already_processed', false, 'subtotal', v_subtotal,
    'unavailable_ids', to_jsonb(coalesce(v_unavailable_ids, array[]::uuid[]))
  );
end;
$function$;

create or replace function public.pay_b2b_order_with_wallet(p_reseller_id uuid, p_product_ids uuid[], p_shipping_address jsonb, p_billing_address jsonb, p_email text, p_placed_by_profile_id uuid, p_shipping_cost numeric DEFAULT 0, p_insured_product_ids uuid[] DEFAULT '{}'::uuid[], p_insurance_cost numeric DEFAULT 0, p_grouped_with_order_id uuid DEFAULT NULL::uuid, p_insured_value numeric DEFAULT 0, p_discount_rate numeric DEFAULT 0, p_discount_amount numeric DEFAULT 0, p_promo_discount_amount numeric DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_balance numeric;
  v_reserved_ids uuid[];
  v_unavailable_ids uuid[];
  v_subtotal numeric;
  v_total numeric;
  v_order_id uuid;
  v_order_number text;
  v_tx_id uuid;
  v_batch_id uuid;
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

  v_batch_id := public.get_or_create_open_batch(p_reseller_id);

  insert into public.orders (
    order_number, email, status, total_amount, subtotal, shipping_cost, insurance_cost, insured_value,
    discount_rate, discount_amount, promo_discount_amount, currency,
    payment_status, shipping_address, billing_address, reseller_id, placed_by_profile_id,
    order_channel, approval_status, approved_at,
    grouped_with_order_id, batch_id
  ) values (
    v_order_number, p_email, 'confirmed',
    v_total,
    v_subtotal, coalesce(p_shipping_cost, 0), coalesce(p_insurance_cost, 0), coalesce(p_insured_value, 0),
    coalesce(p_discount_rate, 0), coalesce(p_discount_amount, 0), coalesce(p_promo_discount_amount, 0), 'EUR',
    'paid', p_shipping_address, coalesce(p_billing_address, p_shipping_address), p_reseller_id, p_placed_by_profile_id,
    'b2b', 'approved', now(),
    p_grouped_with_order_id, v_batch_id
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
$function$;

notify pgrst, 'reload schema';
