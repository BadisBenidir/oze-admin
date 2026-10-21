-- ============================================================================
-- Réservation du panier B2B : timer global de 15 min + plafond absolu.
--
-- (Fonctions créées à l'origine par les migrations du dépôt oze-storefront,
-- 20260902000000…0300 — même base ; reprises ici à l'identique hors timer.)
--   - Chaque ajout relance le timer de TOUT le panier à 15 min (au lieu de 10).
--   - Plafond absolu : jamais au-delà de 35 min après le PREMIER ajout de la
--     session de panier (le plus ancien article encore présent). Une fois
--     atteint, le panier expire (sweep_expired_cart_items, chaque minute) et
--     les articles reviennent en stock. Les articles expirés de l'utilisateur
--     sont purgés à son ajout suivant : un nouvel ajout ouvre alors une
--     nouvelle session.
--   - Paiement Stripe en cours : b2b-checkout prolonge la réservation des
--     articles payés jusqu'à l'expiration de la session Stripe (30 min,
--     cart_hold_for_checkout), pour ne jamais libérer un article en cours de
--     paiement.
--   - Inchangé : verrou de 3 min avant de remettre un article retiré ou
--     expiré, quota de drop (3 articles simultanés, 2 min).
--   - get_cart_state : renvoie aussi session_started_at et hard_cap_at, et
--     ignore les articles déjà expirés (en attente du sweep).
-- ============================================================================

create or replace function public.cart_add_item(p_product_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
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
  if v_product.id is null or v_product.status <> 'for-sale-b2b' then
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

create or replace function public.get_cart_state()
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_user_id uuid := auth.uid();
  v_items jsonb;
  v_global_expires timestamptz;
  v_session_start timestamptz;
  v_drop_started_at timestamptz;
  v_drop_active boolean;
  v_cart_count integer;
  v_last_add_at timestamptz;
  v_free_slots integer;
  v_next_available timestamptz;
begin
  if v_user_id is null or public.current_reseller_id() is null then
    return jsonb_build_object('items', '[]'::jsonb, 'global_expires_at', null, 'server_now', now());
  end if;

  select jsonb_agg(jsonb_build_object(
    'cart_item_id', ci.id,
    'product_id', p.id,
    'product_name', p.name,
    'product_code', p.product_code,
    'sale_price', p.sale_price,
    'brand_name', b.name,
    'category_name', c.name,
    'main_image_url', case
      when p.images is not null and jsonb_typeof(p.images) = 'array' and jsonb_array_length(p.images) > 0
      then p.images ->> coalesce(p.main_image_index, 0)
      else null
    end,
    'added_at', ci.added_at,
    'expires_at', ci.expires_at
  ) order by ci.added_at)
  into v_items
  from public.cart_items ci
  join public.products p on p.id = ci.product_id
  left join public.brands b on b.id = p.brand_id
  left join public.categories c on c.id = p.category_id
  where ci.user_id = v_user_id
    and (ci.expires_at is null or ci.expires_at > now());

  select count(*), max(expires_at), max(added_at), min(added_at)
  into v_cart_count, v_global_expires, v_last_add_at, v_session_start
  from public.cart_items
  where user_id = v_user_id and (expires_at is null or expires_at > now());

  v_drop_started_at := public.current_drop_started_at();
  v_drop_active := v_drop_started_at is not null
    and now() >= v_drop_started_at
    and now() < v_drop_started_at + interval '15 minutes';

  v_free_slots := 3;
  v_next_available := null;

  if v_drop_active then
    v_free_slots := greatest(0, 3 - coalesce(v_cart_count, 0));

    if coalesce(v_cart_count, 0) >= 3 and v_last_add_at is not null
       and v_last_add_at + interval '2 minutes' > now() then
      v_next_available := v_last_add_at + interval '2 minutes';
    end if;
  end if;

  return jsonb_build_object(
    'items', coalesce(v_items, '[]'::jsonb),
    'global_expires_at', v_global_expires,
    'session_started_at', v_session_start,
    'hard_cap_at', case when v_session_start is null then null else v_session_start + interval '35 minutes' end,
    'server_now', now(),
    'drop', jsonb_build_object(
      'active', coalesce(v_drop_active, false),
      'drop_started_at', v_drop_started_at,
      'free_slots_remaining', v_free_slots,
      'next_add_available_at', v_next_available
    )
  );
end;
$function$;

-- Paiement Stripe en cours (b2b-checkout, service uniquement) : les articles
-- payés restent réservés jusqu'à l'expiration de la session Stripe — jamais
-- plus de 30 min à partir de maintenant, jamais raccourcis.
create or replace function public.cart_hold_for_checkout(p_user_id uuid, p_product_ids uuid[], p_until timestamptz)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_count integer;
begin
  update public.cart_items
  set expires_at = greatest(expires_at, least(p_until, now() + interval '30 minutes'))
  where user_id = p_user_id and product_id = any(p_product_ids)
    and (expires_at is null or expires_at > now());
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

revoke all on function public.cart_hold_for_checkout(uuid, uuid[], timestamptz) from public, anon, authenticated;
grant execute on function public.cart_hold_for_checkout(uuid, uuid[], timestamptz) to service_role;

notify pgrst, 'reload schema';
