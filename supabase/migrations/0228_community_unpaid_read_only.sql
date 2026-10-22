-- ============================================================================
-- Membres de communauté sans abonnement après la date de leur prix (0221) :
-- ils GARDENT l'accès à toute la plateforme en consultation (catalogue,
-- commandes, factures, portefeuille, suivi) — plus d'écran « Accès suspendu ».
-- Seuls les achats sont refusés, avec un message clair :
--   - cart_add_item : SUBSCRIPTION_REQUIRED (reprise de 0225 + ce contrôle) ;
--   - enchères / validation de sourcing : message « Activez votre abonnement »
--     au lieu du message « Pass Drops » des abonnés Club ;
--   - paiement : can_user_purchase (0221, déjà en place) + message dédié dans
--     b2b-checkout.
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


create or replace function public.auction_bids_require_plan()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.community_access_blocked(new.user_id) then
    raise exception 'Activez votre abonnement OZË PARIS pour enchérir : le bouton est en haut de votre espace.';
  end if;
  if not public.reseller_plan_allows(new.user_id, 'auctions') then
    raise exception 'Les enchères ne sont pas incluses dans votre Pass Drops. Passez au Pass Revendeur pour enchérir.';
  end if;
  return new;
end;
$$;

create or replace function public.sourcing_missions_require_plan()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'completed'
     and old.status is distinct from 'completed'
     and auth.uid() is not null
     and not public.is_admin() then
    if public.community_access_blocked(auth.uid()) then
      raise exception 'Activez votre abonnement OZË PARIS pour valider une mission de sourcing : le bouton est en haut de votre espace.';
    end if;
    if not public.reseller_plan_allows(auth.uid(), 'sourcing') then
      raise exception 'Le sourcing sur mesure n''est pas inclus dans votre Pass Drops. Passez au Pass Revendeur pour valider une mission.';
    end if;
  end if;
  return new;
end;
$$;

notify pgrst, 'reload schema';
