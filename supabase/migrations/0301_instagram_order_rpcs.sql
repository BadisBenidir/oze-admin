-- ============================================================================
-- Ventes Instagram (0300) : fonctions.
--   Admin  : admin_create_instagram_order, admin_cancel_instagram_order,
--            admin_mark_instagram_paid.
--   Public : instagram_order_public_get / _save / _declare — exécutables par
--            service_role SEULEMENT (appelées par l'edge function
--            instagram-order, qui ne renvoie que la commande du jeton).
--   Cœur   : instagram_order_mark_paid (paiement), instagram_release_products,
--            expire_instagram_orders (cron).
-- Montant toujours calculé en base : prix fixés par l'admin + 25 € par
-- certificat Entrupy choisi, livraison offerte.
-- ============================================================================

-- Statuts depuis lesquels un produit peut être proposé sur Instagram.
create or replace function public.instagram_sellable_status(p_status text)
returns boolean
language sql
immutable
as $$
  select p_status in ('draft', 'draft-b2b', 'sourced-b2b', 'drop-b2b', 'for-sale-b2b', 'instant-b2b',
                      'for-sale-online', 'for-sale-other-platform');
$$;

create or replace function public.instagram_entrupy_price()
returns numeric
language sql
immutable
as $$ select 25::numeric $$;

-- Étape affichée (admin + page client).
create or replace function public.instagram_order_stage(l public.instagram_order_links, o public.orders)
returns text
language sql
stable
as $$
  select case
    when l.late_payment_conflict then 'payment_conflict'
    when l.cancelled_at is not null and l.paid_at is null then 'cancelled'
    when l.paid_at is null and l.expired_at is not null then 'expired'
    when l.paid_at is null and l.transfer_declared_at is not null then 'transfer_declared'
    when l.paid_at is null and l.info_submitted_at is not null then 'info_submitted'
    when l.paid_at is null then 'link_sent'
    when o.status = 'delivered' then 'delivered'
    when o.status = 'shipped' then 'shipped'
    else 'paid'
  end;
$$;

-- ---------------------------------------------------------------------------
-- Libère les produits encore réservés par la commande.
create or replace function public.instagram_release_products(p_link_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.instagram_order_links;
  n int;
begin
  select * into l from public.instagram_order_links where id = p_link_id;
  if not found then return 0; end if;
  update public.products p
  set status = coalesce(l.product_prev_status->>p.id::text, 'draft-b2b'),
      reserved_by_order_id = null,
      reserved_at = null
  where p.reserved_by_order_id = l.order_id and p.status = 'reserved-online';
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.instagram_release_products(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Création par l'admin. p_items : [{ "product_id": uuid, "price": 1234.00 }].
create or replace function public.admin_create_instagram_order(p_items jsonb, p_instagram_handle text default null, p_hours int default 48)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  it jsonb;
  pr record;
  v_order_id uuid;
  v_total numeric := 0;
  v_prev jsonb := '{}';
  v_link public.instagram_order_links;
  v_price numeric;
  v_ids uuid[] := '{}';
  v_seq bigint;
begin
  if not public.is_admin() then raise exception 'Accès refusé'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Choisissez au moins un article';
  end if;
  if p_hours is null or p_hours < 1 or p_hours > 24 * 30 then raise exception 'Durée de validité invalide'; end if;

  for it in select * from jsonb_array_elements(p_items) loop
    v_price := round((it->>'price')::numeric, 2);
    if v_price is null or v_price <= 0 then raise exception 'Prix invalide'; end if;
    if (it->>'product_id')::uuid = any(v_ids) then raise exception 'Article en double'; end if;
    v_ids := v_ids || (it->>'product_id')::uuid;
    v_total := v_total + v_price;
  end loop;

  -- N° de commande et référence de virement alignés : IG-2026-0042 / OZE-IG-0042.
  v_seq := nextval('public.instagram_order_ref_seq');
  insert into public.orders (order_number, email, status, payment_status, subtotal, shipping_cost, total_amount, currency,
                             order_channel, sales_source, payment_method)
  values ('IG-' || to_char(now(), 'YYYY') || '-' || lpad(v_seq::text, 4, '0'), '', 'pending', 'pending', v_total, 0, v_total, 'EUR', 'web', 'instagram', 'transfer')
  returning id into v_order_id;

  for it in select * from jsonb_array_elements(p_items) loop
    select p.*, b.name as brand_name, c.name as category_name into pr
    from public.products p
    left join public.brands b on b.id = p.brand_id
    left join public.categories c on c.id = p.category_id
    where p.id = (it->>'product_id')::uuid
    for update of p;
    if not found then raise exception 'Article introuvable'; end if;
    if not public.instagram_sellable_status(pr.status) then
      raise exception 'L''article « % » n''est pas disponible (statut : %)', pr.name, pr.status;
    end if;
    if exists (select 1 from public.auction_items a where a.product_id = pr.id
               and a.status not in ('cancelled', 'unsold', 'ended', 'sold')) then
      raise exception 'L''article « % » est dans une enchère', pr.name;
    end if;

    v_prev := v_prev || jsonb_build_object(pr.id::text, pr.status);
    v_price := round((it->>'price')::numeric, 2);
    insert into public.order_items (order_id, product_id, quantity, unit_price, line_total, product_snapshot)
    values (v_order_id, pr.id, 1, v_price, v_price, jsonb_strip_nulls(jsonb_build_object(
      'name', pr.name, 'images', pr.images, 'main_image_index', pr.main_image_index,
      'product_code', pr.product_code, 'reference', pr.reference, 'b2b_reference', pr.b2b_reference,
      'condition', pr.condition, 'brand_name', pr.brand_name, 'category_name', pr.category_name,
      'genre', pr.genre, 'purchase_price', pr.purchase_price)));

    update public.products set status = 'reserved-online', reserved_by_order_id = v_order_id, reserved_at = now()
    where id = pr.id;
    -- Hors des paniers B2B en cours.
    delete from public.cart_items where product_id = pr.id;
    delete from public.b2b_cart_holds where product_id = pr.id;
  end loop;

  insert into public.instagram_order_links (order_id, payment_reference, instagram_handle, expires_at, product_prev_status)
  values (v_order_id, 'OZE-IG-' || lpad(v_seq::text, 4, '0'), nullif(btrim(ltrim(coalesce(p_instagram_handle, ''), '@ ')), ''), now() + make_interval(hours => p_hours), v_prev)
  returning * into v_link;

  return jsonb_build_object('order_id', v_order_id, 'token', v_link.token, 'reference', v_link.payment_reference,
                            'total', v_total, 'expires_at', v_link.expires_at);
end;
$$;
revoke all on function public.admin_create_instagram_order(jsonb, text, int) from public, anon;
grant execute on function public.admin_create_instagram_order(jsonb, text, int) to authenticated;

-- ---------------------------------------------------------------------------
-- Annulation par l'admin (seulement si pas payée).
create or replace function public.admin_cancel_instagram_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.instagram_order_links;
begin
  if not public.is_admin() then raise exception 'Accès refusé'; end if;
  select * into l from public.instagram_order_links where order_id = p_order_id for update;
  if not found then raise exception 'Commande Instagram introuvable'; end if;
  if l.paid_at is not null then raise exception 'Commande déjà payée : annulation impossible ici'; end if;
  perform public.instagram_release_products(l.id);
  update public.instagram_order_links set cancelled_at = now() where id = l.id;
  update public.orders set status = 'cancelled' where id = p_order_id;
end;
$$;
revoke all on function public.admin_cancel_instagram_order(uuid) from public, anon;
grant execute on function public.admin_cancel_instagram_order(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Paiement validé (rapprochement Qonto ou admin). Idempotent.
-- Renvoie 'paid', 'already_paid' ou 'conflict' (virement après expiration et
-- article déjà reparti : la commande reste annulée, à rembourser).
create or replace function public.instagram_order_mark_paid(p_link_id uuid, p_bank_tx uuid, p_manual boolean)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.instagram_order_links;
  o public.orders;
  v_missing int;
  v_n_entrupy int;
begin
  select * into l from public.instagram_order_links where id = p_link_id for update;
  if not found then raise exception 'Commande Instagram introuvable'; end if;
  if l.paid_at is not null then return 'already_paid'; end if;
  select * into o from public.orders where id = l.order_id for update;

  if p_bank_tx is not null then
    if exists (select 1 from public.instagram_order_links where bank_transaction_id = p_bank_tx and id <> l.id)
       or exists (select 1 from public.wallet_transactions where bank_transaction_id = p_bank_tx)
       or exists (select 1 from public.bank_transactions where id = p_bank_tx
                  and (matched_type is not null or reconciliation_status <> 'unmatched')) then
      raise exception 'Ce virement est déjà rapproché d''une autre opération';
    end if;
    update public.bank_transactions
    set reconciliation_status = 'matched', matched_type = 'order', matched_order_id = l.order_id,
        note = 'Vente Instagram ' || l.payment_reference || ' (' || o.order_number || ')'
    where id = p_bank_tx;
  end if;

  -- Lien expiré / annulé : on reprend les articles s'ils sont encore libres.
  if l.expired_at is not null or l.cancelled_at is not null then
    perform 1 from public.products p
    where p.id in (select product_id from public.order_items where order_id = l.order_id) for update;
    select count(*) into v_missing
    from public.order_items oi join public.products p on p.id = oi.product_id
    where oi.order_id = l.order_id
      and not (p.status = 'reserved-online' and p.reserved_by_order_id = l.order_id)
      and not public.instagram_sellable_status(p.status);
    if v_missing > 0 then
      update public.instagram_order_links
      set late_payment_conflict = true, bank_transaction_id = coalesce(p_bank_tx, bank_transaction_id)
      where id = l.id;
      return 'conflict';
    end if;
  end if;

  v_n_entrupy := coalesce(array_length(l.entrupy_product_ids, 1), 0);

  update public.products p
  set status = 'sold-online', reserved_by_order_id = null, reserved_at = null
  where p.id in (select product_id from public.order_items where order_id = l.order_id);

  update public.order_items
  set entrupy_requested = true, entrupy_cost = public.instagram_entrupy_price(), entrupy_requested_at = now()
  where order_id = l.order_id and product_id = any(l.entrupy_product_ids);

  update public.orders
  set status = 'confirmed', payment_status = 'paid', payment_method = 'transfer', paid_at = now(),
      entrupy_cost = v_n_entrupy * public.instagram_entrupy_price()
  where id = l.order_id;

  update public.instagram_order_links
  set paid_at = now(), paid_manually = p_manual, bank_transaction_id = coalesce(p_bank_tx, bank_transaction_id),
      expired_at = null, cancelled_at = null, late_payment_conflict = false
  where id = l.id;

  perform public.assign_web_invoice(l.order_id);
  return 'paid';
end;
$$;
revoke all on function public.instagram_order_mark_paid(uuid, uuid, boolean) from public, anon, authenticated;

-- Secours admin : marquer payé (avec ou sans opération Qonto).
create or replace function public.admin_mark_instagram_paid(p_order_id uuid, p_bank_transaction_id uuid default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link uuid;
begin
  if not public.is_admin() then raise exception 'Accès refusé'; end if;
  select id into v_link from public.instagram_order_links where order_id = p_order_id;
  if v_link is null then raise exception 'Commande Instagram introuvable'; end if;
  return public.instagram_order_mark_paid(v_link, p_bank_transaction_id, true);
end;
$$;
revoke all on function public.admin_mark_instagram_paid(uuid, uuid) from public, anon;
grant execute on function public.admin_mark_instagram_paid(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Expiration (cron toutes les 5 min). Virement annoncé : réservation
-- prolongée (expires_at repoussé par instagram_order_public_declare).
create or replace function public.expire_instagram_orders()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  n int := 0;
begin
  for r in
    select id, order_id from public.instagram_order_links
    where paid_at is null and cancelled_at is null and expired_at is null and expires_at < now()
    for update skip locked
  loop
    perform public.instagram_release_products(r.id);
    update public.instagram_order_links set expired_at = now() where id = r.id;
    update public.orders set status = 'cancelled' where id = r.order_id and status = 'pending';
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.expire_instagram_orders() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- PUBLIC (service_role) : lecture de la commande d'un jeton.
create or replace function public.instagram_order_public_get(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.instagram_order_links;
  o public.orders;
  s public.wallet_settings;
  v_items jsonb;
  v_invoice text;
begin
  if p_token is null or length(p_token) < 20 then return jsonb_build_object('status', 'invalid'); end if;
  select * into l from public.instagram_order_links where token = p_token;
  if not found then return jsonb_build_object('status', 'invalid'); end if;
  select * into o from public.orders where id = l.order_id;
  select * into s from public.wallet_settings limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
           'product_id', oi.product_id,
           'name', oi.product_snapshot->>'name',
           'brand', oi.product_snapshot->>'brand_name',
           'condition', oi.product_snapshot->>'condition',
           'images', oi.product_snapshot->'images',
           'main_image_index', oi.product_snapshot->'main_image_index',
           'price', oi.unit_price,
           'entrupy', oi.product_id = any(l.entrupy_product_ids)
         ) order by oi.created_at), '[]')
  into v_items
  from public.order_items oi where oi.order_id = l.order_id;

  select invoice_number into v_invoice from public.invoices where order_id = l.order_id and kind = 'order'
  order by issued_at desc limit 1;

  return jsonb_build_object(
    'status', 'ok',
    'stage', public.instagram_order_stage(l, o),
    'order_number', o.order_number,
    'reference', l.payment_reference,
    'expires_at', l.expires_at,
    'items', v_items,
    'entrupy_price', public.instagram_entrupy_price(),
    'subtotal', o.subtotal,
    'shipping_cost', 0,
    'total', o.total_amount,
    'email', nullif(o.email, ''),
    'shipping_address', o.shipping_address,
    'info_submitted', l.info_submitted_at is not null,
    'transfer_declared_at', l.transfer_declared_at,
    'paid_at', l.paid_at,
    'invoice_number', v_invoice,
    'tracking_number', o.tracking_number,
    'tracking_url', o.tracking_url,
    'bank', case when l.paid_at is null then jsonb_build_object('beneficiary', s.beneficiary, 'iban', s.iban, 'bic', s.bic) end
  );
end;
$$;
revoke all on function public.instagram_order_public_get(text) from public, anon, authenticated;
grant execute on function public.instagram_order_public_get(text) to service_role;

-- PUBLIC (service_role) : le client enregistre livraison + e-mail + certificats.
create or replace function public.instagram_order_public_save(p_token text, p_email text, p_shipping jsonb, p_entrupy_product_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.instagram_order_links;
  v_sa jsonb := '{}';
  k text;
  v_entrupy uuid[];
  v_items_total numeric;
  v_total numeric;
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  select * into l from public.instagram_order_links where token = p_token for update;
  if not found then raise exception 'Lien invalide'; end if;
  if l.paid_at is not null or l.cancelled_at is not null or l.expired_at is not null or l.expires_at < now() then
    raise exception 'Cette commande ne peut plus être modifiée';
  end if;
  if l.transfer_declared_at is not null then
    raise exception 'Virement déjà annoncé : la commande ne peut plus être modifiée';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 200 then raise exception 'E-mail invalide'; end if;

  -- Adresse : uniquement les champs attendus, texte court.
  foreach k in array array['first_name', 'last_name', 'address', 'address_line_2', 'city', 'postcode', 'country', 'phone',
                           'pickup_point_code', 'pickup_point_name', 'pickup_point_network', 'pickup_point_address',
                           'pickup_point_city', 'pickup_point_zip'] loop
    if nullif(btrim(coalesce(p_shipping->>k, '')), '') is not null then
      v_sa := v_sa || jsonb_build_object(k, left(btrim(p_shipping->>k), 200));
    end if;
  end loop;
  if v_sa->>'first_name' is null or v_sa->>'last_name' is null or v_sa->>'phone' is null
     or v_sa->>'address' is null or v_sa->>'city' is null or v_sa->>'postcode' is null then
    raise exception 'Adresse incomplète';
  end if;
  if (v_sa ? 'pickup_point_name' or v_sa ? 'pickup_point_code')
     and (v_sa->>'pickup_point_name' is null or v_sa->>'pickup_point_address' is null
          or v_sa->>'pickup_point_zip' is null or v_sa->>'pickup_point_city' is null) then
    raise exception 'Point relais incomplet';
  end if;
  v_sa := v_sa || jsonb_build_object('name', (v_sa->>'first_name') || ' ' || (v_sa->>'last_name'),
                                     'country', coalesce(v_sa->>'country', 'France'));

  -- Certificats : seulement des articles de la commande.
  select coalesce(array_agg(distinct oi.product_id), '{}') into v_entrupy
  from public.order_items oi
  where oi.order_id = l.order_id and oi.product_id = any(coalesce(p_entrupy_product_ids, '{}'));

  select sum(line_total) into v_items_total from public.order_items where order_id = l.order_id and status = 'active';
  v_total := v_items_total + coalesce(array_length(v_entrupy, 1), 0) * public.instagram_entrupy_price();

  update public.orders
  set email = v_email, shipping_address = v_sa, billing_address = v_sa,
      subtotal = v_total, shipping_cost = 0, total_amount = v_total
  where id = l.order_id;
  update public.instagram_order_links
  set entrupy_product_ids = v_entrupy, info_submitted_at = now()
  where id = l.id;
  return jsonb_build_object('total', v_total);
end;
$$;
revoke all on function public.instagram_order_public_save(text, text, jsonb, uuid[]) from public, anon, authenticated;
grant execute on function public.instagram_order_public_save(text, text, jsonb, uuid[]) to service_role;

-- PUBLIC (service_role) : « J'ai fait le virement ». N'ENREGISTRE QU'UNE
-- ANNONCE : ne valide jamais le paiement. Réservation prolongée de 4 jours
-- (le temps qu'un virement classique arrive).
create or replace function public.instagram_order_public_declare(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.instagram_order_links;
begin
  select * into l from public.instagram_order_links where token = p_token for update;
  if not found then raise exception 'Lien invalide'; end if;
  if l.paid_at is not null then return; end if;
  if l.cancelled_at is not null or l.expired_at is not null then raise exception 'Ce lien a expiré'; end if;
  if l.info_submitted_at is null then raise exception 'Renseignez d''abord vos informations de livraison'; end if;
  update public.instagram_order_links
  set transfer_declared_at = coalesce(transfer_declared_at, now()),
      expires_at = greatest(expires_at, now() + interval '4 days')
  where id = l.id;
end;
$$;
revoke all on function public.instagram_order_public_declare(text) from public, anon, authenticated;
grant execute on function public.instagram_order_public_declare(text) to service_role;

notify pgrst, 'reload schema';
