-- ============================================================================
-- Achat immédiat : statut produit dédié 'instant-b2b' (« Achat immédiat B2B »),
-- dissocié de 'for-sale-b2b' (« Revendeurs B2B », le Catalogue).
--
-- products.instant_buy (0253) devient un simple reflet du statut (trigger) :
-- vues revendeur et front continuent de filtrer dessus.
-- Partout où un article 'for-sale-b2b' est réservable / payable, 'instant-b2b'
-- l'est aussi (fonctions de production reprises à l'identique, seule la
-- condition de statut change) :
--   cart_add_item, guard_cart_item_purchasable, confirm_b2b_payment,
--   pay_b2b_order_with_wallet, apply_due_b2b_price_changes (baisses de prix),
--   generate_b2b_reference, sync_auction_product_status (mise aux enchères).
-- Les articles déjà en achat immédiat passent au nouveau statut.
-- ============================================================================

alter table public.products drop constraint if exists products_status_check;
alter table public.products add constraint products_status_check check (status::text = any (array[
  'draft', 'draft-b2b', 'sourced-b2b', 'drop-b2b', 'auction-b2b', 'for-sale-online', 'for-sale-other-platform',
  'sold-online', 'sold-other-platform', 'sold-display', 'for-auction-live', 'sold-auction', 'for-sale-b2b',
  'instant-b2b', 'reserved-b2b', 'sold-b2b', 'archived', 'cadeau', 'cadeau-attribue', 'cadeau-livre'
]::text[]));

create or replace function public.products_instant_buy_only_for_sale()
returns trigger
language plpgsql
as $$
begin
  new.instant_buy := (new.status::text = 'instant-b2b');
  return new;
end;
$$;

update public.products set status = 'instant-b2b' where instant_buy and status::text = 'for-sale-b2b';

CREATE OR REPLACE FUNCTION public.cart_add_item(p_product_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_product record;
  v_lock record;
  v_drop_started_at timestamptz;
  v_drop_active boolean;
  v_cart_count integer;
  v_last_add_at timestamptz;
  v_session_start timestamptz;
  v_hard_cap timestamptz;
  v_global_expires timestamptz;
begin
  if v_user_id is null then
    return jsonb_build_object('success', false, 'error_code', 'AUTH_REQUIRED',
      'message', 'Vous devez être connecté pour ajouter un article au panier.');
  end if;

  if public.current_reseller_id() is null then
    return jsonb_build_object('success', false, 'error_code', 'ACCESS_DENIED',
      'message', 'Accès réservé aux revendeurs actifs.');
  end if;

  -- Membre de communauté sans abonnement après la date de son prix (0221) :
  -- il garde l'accès à tout en consultation, mais ne peut plus réserver.
  if public.community_access_blocked(v_user_id) then
    return jsonb_build_object('success', false, 'error_code', 'SUBSCRIPTION_REQUIRED',
      'message', 'Activez votre abonnement OZË PARIS pour commander : le bouton est en haut de votre espace.');
  end if;

  -- Purge opportuniste : réservation expirée sur CE produit (autre client),
  -- et articles expirés du panier de l'utilisateur lui-même (le sweep passe
  -- au plus chaque minute) — avec le verrou de 3 min habituel.
  with expired as (
    delete from public.cart_items
    where (product_id = p_product_id or user_id = v_user_id)
      and expires_at is not null and expires_at < now()
    returning user_id, product_id
  )
  insert into public.cart_item_removal_locks (user_id, product_id, locked_until)
  select user_id, product_id, now() + interval '3 minutes' from expired
  on conflict (user_id, product_id) do update set locked_until = excluded.locked_until;

  select id, status into v_product from public.products where id = p_product_id for update;
  if v_product.id is null or v_product.status not in ('for-sale-b2b', 'instant-b2b') then
    return jsonb_build_object('success', false, 'error_code', 'PRODUCT_UNAVAILABLE',
      'message', 'Cet article n''est plus disponible à la vente.');
  end if;

  if exists (select 1 from public.cart_items where user_id = v_user_id and product_id = p_product_id) then
    return jsonb_build_object('success', false, 'error_code', 'ALREADY_IN_CART',
      'message', 'Cet article est déjà dans votre panier.');
  end if;

  select locked_until into v_lock
  from public.cart_item_removal_locks
  where user_id = v_user_id and product_id = p_product_id;

  if v_lock.locked_until is not null and v_lock.locked_until > now() then
    return jsonb_build_object(
      'success', false,
      'error_code', 'ITEM_RECENTLY_REMOVED',
      'message', 'Vous avez récemment retiré cet article. Vous devez patienter avant de pouvoir le réserver à nouveau.',
      'retry_after_seconds', ceil(extract(epoch from (v_lock.locked_until - now())))::int
    );
  end if;

  if exists (
    select 1 from public.cart_items
    where product_id = p_product_id and user_id <> v_user_id
      and expires_at is not null and expires_at > now()
  ) then
    return jsonb_build_object('success', false, 'error_code', 'RESERVED_BY_OTHER',
      'message', 'Cet article vient d''être réservé par un autre client.');
  end if;

  v_drop_started_at := public.current_drop_started_at();
  v_drop_active := v_drop_started_at is not null
    and now() >= v_drop_started_at
    and now() < v_drop_started_at + interval '15 minutes';

  if v_drop_active then
    select count(*), max(added_at) into v_cart_count, v_last_add_at
    from public.cart_items
    where user_id = v_user_id;

    if v_cart_count >= 3 and v_last_add_at is not null
       and now() < v_last_add_at + interval '2 minutes' then
      return jsonb_build_object(
        'success', false,
        'error_code', 'DROP_QUOTA_COOLDOWN',
        'message', 'Limite d''ajout atteinte. Veuillez patienter avant d''ajouter un nouvel article.',
        'retry_after_seconds', ceil(extract(epoch from (v_last_add_at + interval '2 minutes' - now())))::int
      );
    end if;
  end if;

  -- Session de panier : démarre au plus ancien article encore présent.
  select coalesce(min(added_at), now()) into v_session_start from public.cart_items where user_id = v_user_id;
  v_hard_cap := v_session_start + interval '35 minutes';
  v_global_expires := least(now() + interval '15 minutes', v_hard_cap);

  begin
    insert into public.cart_items (user_id, product_id, session_id, added_at, expires_at)
    values (v_user_id, p_product_id, null, now(), v_global_expires);
  exception when unique_violation then
    return jsonb_build_object('success', false, 'error_code', 'RESERVED_BY_OTHER',
      'message', 'Cet article vient d''être réservé par un autre client.');
  end;

  -- Timer global : relancé pour TOUT le panier, sans dépasser le plafond.
  -- Une réservation déjà prolongée pour un paiement en cours n'est jamais raccourcie.
  update public.cart_items
  set expires_at = greatest(expires_at, v_global_expires)
  where user_id = v_user_id and product_id <> p_product_id;

  select count(*) into v_cart_count from public.cart_items where user_id = v_user_id;

  return jsonb_build_object(
    'success', true,
    'product_id', p_product_id,
    'global_expires_at', v_global_expires,
    'session_started_at', v_session_start,
    'hard_cap_at', v_hard_cap,
    'cart_count', v_cart_count,
    'server_now', now()
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_b2b_payment(p_reseller_id uuid, p_product_ids uuid[], p_shipping_address jsonb, p_billing_address jsonb, p_stripe_session_id text, p_stripe_payment_intent_id text, p_email text, p_placed_by_profile_id uuid DEFAULT NULL::uuid, p_shipping_cost numeric DEFAULT 0, p_insured_product_ids uuid[] DEFAULT '{}'::uuid[], p_insurance_cost numeric DEFAULT 0, p_grouped_with_order_id uuid DEFAULT NULL::uuid, p_insured_value numeric DEFAULT 0, p_discount_rate numeric DEFAULT 0, p_discount_amount numeric DEFAULT 0, p_entrupy_product_ids uuid[] DEFAULT '{}'::uuid[], p_entrupy_cost numeric DEFAULT 0)
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
    where id = any(p_product_ids) and status in ('for-sale-b2b', 'instant-b2b')
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
$function$;

CREATE OR REPLACE FUNCTION public.confirm_b2b_payment(p_reseller_id uuid, p_product_ids uuid[], p_shipping_address jsonb, p_billing_address jsonb, p_stripe_session_id text, p_stripe_payment_intent_id text, p_email text, p_placed_by_profile_id uuid DEFAULT NULL::uuid, p_shipping_cost numeric DEFAULT 0, p_insured_product_ids uuid[] DEFAULT '{}'::uuid[], p_insurance_cost numeric DEFAULT 0, p_grouped_with_order_id uuid DEFAULT NULL::uuid, p_insured_value numeric DEFAULT 0, p_discount_rate numeric DEFAULT 0, p_discount_amount numeric DEFAULT 0, p_entrupy_product_ids uuid[] DEFAULT '{}'::uuid[])
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
  v_entrupy_total numeric;
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
    where id = any(p_product_ids) and status in ('for-sale-b2b', 'instant-b2b')
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
  select coalesce(count(*) filter (where p.id = any(p_entrupy_product_ids)), 0) * 19.99 into v_entrupy_total
  from public.products p where p.id = any(v_reserved_ids);

  v_order_number := 'B2B-' || to_char(now(), 'YYYYMMDDHH24MISS') || '-' || substr(p_reseller_id::text, 1, 4);

  insert into public.orders (
    order_number, email, status, total_amount, subtotal, shipping_cost, insurance_cost, insured_value,
    discount_rate, discount_amount, entrupy_total, currency,
    payment_status, shipping_address, billing_address, reseller_id, placed_by_profile_id,
    order_channel, approval_status, approved_at, stripe_session_id, stripe_payment_intent_id,
    grouped_with_order_id
  ) values (
    v_order_number, p_email, 'confirmed',
    v_subtotal - coalesce(p_discount_amount, 0) + coalesce(p_shipping_cost, 0) + coalesce(p_insurance_cost, 0) + v_entrupy_total,
    v_subtotal, coalesce(p_shipping_cost, 0), coalesce(p_insurance_cost, 0), coalesce(p_insured_value, 0),
    coalesce(p_discount_rate, 0), coalesce(p_discount_amount, 0), v_entrupy_total, 'EUR',
    'paid', p_shipping_address, coalesce(p_billing_address, p_shipping_address), p_reseller_id, p_placed_by_profile_id,
    'b2b', 'approved', now(), p_stripe_session_id, p_stripe_payment_intent_id,
    p_grouped_with_order_id
  )
  returning id into v_order_id;

  insert into public.order_items (order_id, product_id, quantity, unit_price, line_total, product_snapshot, insured, insurance_cost, has_entrupy_certificate, entrupy_price)
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
$function$;

CREATE OR REPLACE FUNCTION public.pay_b2b_order_with_wallet(p_reseller_id uuid, p_product_ids uuid[], p_shipping_address jsonb, p_billing_address jsonb, p_email text, p_placed_by_profile_id uuid, p_shipping_cost numeric DEFAULT 0, p_insured_product_ids uuid[] DEFAULT '{}'::uuid[], p_insurance_cost numeric DEFAULT 0, p_grouped_with_order_id uuid DEFAULT NULL::uuid, p_insured_value numeric DEFAULT 0, p_discount_rate numeric DEFAULT 0, p_discount_amount numeric DEFAULT 0, p_promo_discount_amount numeric DEFAULT 0, p_entrupy_product_ids uuid[] DEFAULT '{}'::uuid[], p_entrupy_cost numeric DEFAULT 0)
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
    where id = any(p_product_ids) and status in ('for-sale-b2b', 'instant-b2b')
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
$function$;

CREATE OR REPLACE FUNCTION public.pay_b2b_order_with_wallet(p_reseller_id uuid, p_product_ids uuid[], p_shipping_address jsonb, p_billing_address jsonb, p_email text, p_placed_by_profile_id uuid, p_shipping_cost numeric DEFAULT 0, p_insured_product_ids uuid[] DEFAULT '{}'::uuid[], p_insurance_cost numeric DEFAULT 0, p_grouped_with_order_id uuid DEFAULT NULL::uuid, p_insured_value numeric DEFAULT 0, p_discount_rate numeric DEFAULT 0, p_discount_amount numeric DEFAULT 0, p_promo_discount_amount numeric DEFAULT 0, p_entrupy_product_ids uuid[] DEFAULT '{}'::uuid[])
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
  v_entrupy_total numeric;
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
    where id = any(p_product_ids) and status in ('for-sale-b2b', 'instant-b2b')
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
  select coalesce(count(*) filter (where p.id = any(p_entrupy_product_ids)), 0) * 19.99 into v_entrupy_total
  from public.products p where p.id = any(v_reserved_ids);

  v_total := v_subtotal - coalesce(p_discount_amount, 0) - coalesce(p_promo_discount_amount, 0)
    + coalesce(p_shipping_cost, 0) + coalesce(p_insurance_cost, 0) + v_entrupy_total;

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
    discount_rate, discount_amount, promo_discount_amount, entrupy_total, currency,
    payment_status, shipping_address, billing_address, reseller_id, placed_by_profile_id,
    order_channel, approval_status, approved_at,
    grouped_with_order_id
  ) values (
    v_order_number, p_email, 'confirmed',
    v_total,
    v_subtotal, coalesce(p_shipping_cost, 0), coalesce(p_insurance_cost, 0), coalesce(p_insured_value, 0),
    coalesce(p_discount_rate, 0), coalesce(p_discount_amount, 0), coalesce(p_promo_discount_amount, 0), v_entrupy_total, 'EUR',
    'paid', p_shipping_address, coalesce(p_billing_address, p_shipping_address), p_reseller_id, p_placed_by_profile_id,
    'b2b', 'approved', now(),
    p_grouped_with_order_id
  )
  returning id into v_order_id;

  insert into public.order_items (order_id, product_id, quantity, unit_price, line_total, product_snapshot, insured, insurance_cost, has_entrupy_certificate, entrupy_price)
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
$function$;

CREATE OR REPLACE FUNCTION public.guard_cart_item_purchasable()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_status text;
begin
  select status into v_status from public.products where id = new.product_id;
  if v_status is null or v_status not in ('for-sale-b2b', 'instant-b2b') then
    raise exception 'Cet article n''est pas disponible à l''achat pour le moment (avant-première ou indisponible).';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.generate_b2b_reference()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  v_year text := to_char(now(), 'YYYY');
  v_candidate text;
  v_attempts int := 0;
begin
  if new.status in ('draft-b2b', 'drop-b2b', 'for-sale-b2b', 'instant-b2b', 'reserved-b2b', 'sold-b2b') and new.b2b_reference is null then
    loop
      v_candidate := 'OZE-B2B-' || v_year || '-' || lpad(floor(random() * 10000)::int::text, 4, '0');
      exit when not exists (select 1 from public.products where b2b_reference = v_candidate);
      v_attempts := v_attempts + 1;
      if v_attempts > 50 then
        raise exception 'Impossible de générer une référence B2B unique après 50 tentatives';
      end if;
    end loop;
    new.b2b_reference := v_candidate;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.apply_due_b2b_price_changes()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_applied int := 0;
  v_skipped int := 0;
  v_change record;
  v_product record;
begin
  for v_change in
    select * from public.b2b_price_changes
    where status = 'scheduled' and scheduled_at <= now()
    order by scheduled_at
    for update skip locked
  loop
    select id, status, sale_price, original_price into v_product from public.products where id = v_change.product_id for update;
    if not found or v_product.status not in ('for-sale-b2b', 'instant-b2b') then
      update public.b2b_price_changes
      set status = 'skipped', old_price = v_product.sale_price, applied_at = now()
      where id = v_change.id;
      v_skipped := v_skipped + 1;
      continue;
    end if;

    update public.products
    set sale_price = v_change.new_price,
        original_price = case
          when v_change.new_price < v_product.sale_price
            then greatest(coalesce(v_product.original_price, 0), v_product.sale_price)
          when coalesce(v_product.original_price, 0) > v_change.new_price
            then v_product.original_price
          else null
        end,
        updated_at = now()
    where id = v_change.product_id;

    update public.b2b_price_changes
    set status = 'applied', old_price = v_product.sale_price, applied_at = now()
    where id = v_change.id;
    v_applied := v_applied + 1;
  end loop;

  return jsonb_build_object('applied', v_applied, 'skipped', v_skipped);
end;
$function$;

CREATE OR REPLACE FUNCTION public.sync_auction_product_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_status text;
begin
  -- Ancienne fiche libérée : lot supprimé, fiche remplacée/détachée, ou lot
  -- sorti des statuts engagés (non vendu). Un lot annulé fixe lui-même le
  -- statut du produit (0156).
  if tg_op in ('UPDATE', 'DELETE') and old.product_id is not null
     and (tg_op = 'DELETE'
          or new.product_id is distinct from old.product_id
          or new.status not in ('active', 'sold')) then
    update public.products
    set status = case when b2b_reference is not null then 'draft-b2b' else 'draft' end
    where id = old.product_id and status = 'auction-b2b';
  end if;

  if tg_op in ('INSERT', 'UPDATE') and new.product_id is not null and new.status in ('active', 'sold')
     and (tg_op = 'INSERT' or new.product_id is distinct from old.product_id or old.status not in ('active', 'sold')) then
    select status into v_status from public.products where id = new.product_id for update;

    if v_status like 'sold-%' or v_status in ('reserved-b2b', 'archived', 'cadeau', 'cadeau-attribue', 'cadeau-livre') then
      raise exception 'Cette pièce n''est plus disponible (statut : %) — elle ne peut pas être mise en enchère', v_status;
    end if;

    if v_status in ('draft', 'draft-b2b', 'for-sale-b2b', 'instant-b2b', 'drop-b2b') then
      update public.products set status = 'auction-b2b' where id = new.product_id;
      -- Plus achetable au catalogue : retirée des paniers et d'un drop encore planifié.
      delete from public.cart_items where product_id = new.product_id;
      update public.drops
      set product_ids = array_remove(product_ids, new.product_id)
      where status = 'planifie'
        and new.product_id = any(product_ids)
        and array_length(product_ids, 1) > 1;
    end if;
  end if;

  return coalesce(new, old);
end;
$function$;

create or replace function public.admin_set_instant_buy(
  p_product_ids uuid[],
  p_enabled boolean,
  p_target text default 'draft-b2b'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
  v_now timestamptz := now();
begin
  if not public.is_admin() then
    raise exception 'Accès refusé';
  end if;

  if p_enabled then
    update public.products p
    set status = 'instant-b2b',
        catalog_sort_at = v_now - (u.ord * interval '1 millisecond')
    from unnest(p_product_ids) with ordinality as u(pid, ord)
    where p.id = u.pid
      and p.status::text in ('draft', 'draft-b2b', 'for-sale-b2b')
      and coalesce(p.sale_price, 0) > 0;
  else
    if p_target not in ('for-sale-b2b', 'draft-b2b') then
      raise exception 'Destination invalide : %', p_target;
    end if;
    update public.products p
    set status = p_target
    where p.id = any(p_product_ids)
      and p.status::text = 'instant-b2b';
  end if;

  get diagnostics v_count = row_count;
  return jsonb_build_object('updated_count', v_count);
end;
$$;

create or replace view public.b2b_catalog as
 SELECT id,
    product_code,
    reference,
    b2b_reference,
    name,
    brand_id,
    category_id,
    genre,
    weight,
    images,
    main_image_index,
    condition,
    description,
    colors,
    material,
    status,
    created_at,
    sale_price AS price,
    defects,
    defect_images,
    (EXISTS ( SELECT 1
           FROM cart_items ci
          WHERE ci.product_id = p.id AND ci.user_id <> auth.uid() AND ci.expires_at IS NOT NULL AND ci.expires_at > now())) AS held_by_other,
    original_price,
    ( SELECT d.scheduled_at
           FROM drops d
          WHERE d.status = 'planifie'::text AND (p.id = ANY (d.product_ids))
          ORDER BY d.scheduled_at
         LIMIT 1) AS drop_preview_scheduled_at,
    COALESCE(catalog_sort_at, created_at) AS sort_at,
    instant_buy
   FROM products p
  WHERE NOT (instant_buy AND public.instant_buy_locked()) AND ((status::text = any (array['for-sale-b2b', 'instant-b2b']::text[])) AND (EXISTS ( SELECT 1
           FROM reseller_contacts rc
             JOIN resellers rs ON rs.id = rc.reseller_id
          WHERE rc.profile_id = auth.uid() AND rs.status = 'active'::text)) OR status::text = 'draft'::text AND (EXISTS ( SELECT 1
           FROM drops d
          WHERE d.status = 'planifie'::text AND (p.id = ANY (d.product_ids)))) AND (EXISTS ( SELECT 1
           FROM reseller_contacts rc
             JOIN resellers rs ON rs.id = rc.reseller_id
          WHERE rc.profile_id = auth.uid() AND rs.status = 'active'::text AND rc.can_preview_drops = true)));

create or replace view public.b2b_reseller_product_detail as
 SELECT id,
    product_code,
    reference,
    b2b_reference,
    name,
    brand_id,
    category_id,
    genre,
    weight,
    images,
    main_image_index,
    condition,
    description,
    colors,
    material,
    status,
    created_at,
    sale_price AS price,
    defects,
    defect_images,
    (EXISTS ( SELECT 1
           FROM cart_items ci
          WHERE ci.product_id = p.id AND ci.user_id <> auth.uid() AND ci.expires_at IS NOT NULL AND ci.expires_at > now())) AS held_by_other,
    original_price,
    ( SELECT d.scheduled_at
           FROM drops d
          WHERE d.status = 'planifie'::text AND (p.id = ANY (d.product_ids))
          ORDER BY d.scheduled_at
         LIMIT 1) AS drop_preview_scheduled_at,
    instant_buy
   FROM products p
  WHERE NOT (instant_buy AND public.instant_buy_locked()) AND ((status::text = any (array['for-sale-b2b', 'instant-b2b']::text[])) AND (EXISTS ( SELECT 1
           FROM reseller_contacts rc
             JOIN resellers rs ON rs.id = rc.reseller_id
          WHERE rc.profile_id = auth.uid() AND rs.status = 'active'::text)) OR status::text = 'draft'::text AND (EXISTS ( SELECT 1
           FROM drops d
          WHERE d.status = 'planifie'::text AND (p.id = ANY (d.product_ids)))) AND (EXISTS ( SELECT 1
           FROM reseller_contacts rc
             JOIN resellers rs ON rs.id = rc.reseller_id
          WHERE rc.profile_id = auth.uid() AND rs.status = 'active'::text AND rc.can_preview_drops = true))) OR (EXISTS ( SELECT 1
           FROM order_items oi
             JOIN orders o ON o.id = oi.order_id
          WHERE oi.product_id = p.id AND o.reseller_id = current_reseller_id()));

notify pgrst, 'reload schema';
