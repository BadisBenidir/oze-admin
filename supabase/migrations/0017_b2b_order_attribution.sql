-- Attribution individuelle des commandes B2B : jusqu'ici `orders` ne portait
-- que `reseller_id` (l'entreprise), donc tous les contacts d'un même
-- revendeur voyaient les commandes de leurs collègues sur "Mes commandes".
-- On ajoute qui a concrètement passé la commande, pour filtrer par personne.

alter table public.orders add column if not exists placed_by_profile_id uuid references public.profiles (id);
create index if not exists idx_orders_placed_by_profile_id on public.orders (placed_by_profile_id);

-- Téléphone individuel d'un contact revendeur (absent de `profiles` jusqu'ici
-- — seul `resellers.contact_phone`, au niveau entreprise, existait).
alter table public.profiles add column if not exists phone text;

-- Rattrapage best-effort pour les commandes déjà existantes : on associe par
-- correspondance d'email (imparfait si l'email a changé depuis, mais ne
-- touche que les lignes actuellement NULL, aucun risque d'écraser une
-- attribution déjà connue).
update public.orders o
set placed_by_profile_id = p.id
from public.profiles p
where o.order_channel = 'b2b'
  and o.placed_by_profile_id is null
  and p.email = o.email;

-- submit_b2b_order : reprise à l'identique de la version 0011 (achat
-- instantané), on ajoute uniquement placed_by_profile_id = auth.uid() —
-- fiable ici, appelé directement par le revendeur avec sa propre session.
create or replace function public.submit_b2b_order(
  p_product_ids uuid[],
  p_shipping_address jsonb,
  p_billing_address jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reseller_id uuid;
  v_email text;
  v_reserved_ids uuid[];
  v_unavailable_ids uuid[];
  v_subtotal numeric;
  v_order_id uuid;
  v_order_number text;
begin
  if p_product_ids is null or array_length(p_product_ids, 1) is null then
    raise exception 'Le panier est vide';
  end if;

  v_reseller_id := public.current_reseller_id();
  if v_reseller_id is null then
    raise exception 'Aucun compte revendeur actif associé à cet utilisateur';
  end if;

  select email into v_email from public.profiles where id = auth.uid();

  with reserved as (
    update public.products
    set status = 'sold-b2b', reserved_by_reseller_id = v_reseller_id, reserved_at = now()
    where id = any(p_product_ids) and status = 'for-sale-b2b'
    returning id
  )
  select array_agg(id) into v_reserved_ids from reserved;

  select array_agg(pid) into v_unavailable_ids
  from unnest(p_product_ids) as pid
  where pid <> all (coalesce(v_reserved_ids, array[]::uuid[]));

  if v_unavailable_ids is not null and array_length(v_unavailable_ids, 1) > 0 then
    raise exception 'B2B_UNAVAILABLE_ITEMS:%', array_to_json(v_unavailable_ids)::text;
  end if;

  select coalesce(sum(p.sale_price), 0) into v_subtotal from public.products p where p.id = any(v_reserved_ids);

  v_order_number := 'B2B-' || to_char(now(), 'YYYYMMDDHH24MISS') || '-' || substr(v_reseller_id::text, 1, 4);

  insert into public.orders (
    order_number, email, status, total_amount, subtotal, shipping_cost, currency,
    payment_status, shipping_address, billing_address, reseller_id, placed_by_profile_id,
    order_channel, approval_status, approved_at
  ) values (
    v_order_number, v_email, 'confirmed', v_subtotal, v_subtotal, 0, 'EUR',
    'pending', p_shipping_address, coalesce(p_billing_address, p_shipping_address), v_reseller_id, auth.uid(),
    'b2b', 'approved', now()
  )
  returning id into v_order_id;

  insert into public.order_items (order_id, product_id, quantity, unit_price, line_total, product_snapshot)
  select v_order_id, p.id, 1, p.sale_price, p.sale_price, to_jsonb(p.*)
  from public.products p where p.id = any(v_reserved_ids);

  update public.products set reserved_by_order_id = v_order_id where id = any(v_reserved_ids);

  return jsonb_build_object('order_id', v_order_id, 'order_number', v_order_number, 'subtotal', v_subtotal);
end;
$$;

-- confirm_b2b_payment : appelé par le webhook Stripe (service_role, sans
-- session revendeur) — l'identité de l'acheteur est donc passée en
-- paramètre explicite (capturée côté b2b-checkout, où le contexte
-- authentifié réel existe au moment de la création de la session Stripe).
drop function if exists public.confirm_b2b_payment(uuid, uuid[], jsonb, jsonb, text, text, text);

create or replace function public.confirm_b2b_payment(
  p_reseller_id uuid,
  p_product_ids uuid[],
  p_shipping_address jsonb,
  p_billing_address jsonb,
  p_stripe_session_id text,
  p_stripe_payment_intent_id text,
  p_email text,
  p_placed_by_profile_id uuid default null
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
    order_number, email, status, total_amount, subtotal, shipping_cost, currency,
    payment_status, shipping_address, billing_address, reseller_id, placed_by_profile_id,
    order_channel, approval_status, approved_at, stripe_session_id, stripe_payment_intent_id
  ) values (
    v_order_number, p_email, 'confirmed', v_subtotal, v_subtotal, 0, 'EUR',
    'paid', p_shipping_address, coalesce(p_billing_address, p_shipping_address), p_reseller_id, p_placed_by_profile_id,
    'b2b', 'approved', now(), p_stripe_session_id, p_stripe_payment_intent_id
  )
  returning id into v_order_id;

  insert into public.order_items (order_id, product_id, quantity, unit_price, line_total, product_snapshot)
  select v_order_id, p.id, 1, p.sale_price, p.sale_price, to_jsonb(p.*)
  from public.products p where p.id = any(v_reserved_ids);

  update public.products set reserved_by_order_id = v_order_id where id = any(v_reserved_ids);

  return jsonb_build_object(
    'order_id', v_order_id, 'already_processed', false, 'subtotal', v_subtotal,
    'unavailable_ids', to_jsonb(coalesce(v_unavailable_ids, array[]::uuid[]))
  );
end;
$$;

revoke all on function public.confirm_b2b_payment(uuid, uuid[], jsonb, jsonb, text, text, text, uuid) from public;
revoke all on function public.confirm_b2b_payment(uuid, uuid[], jsonb, jsonb, text, text, text, uuid) from authenticated;

-- RLS : chacun voit ses propres commandes ; le contact principal voit aussi
-- toutes les commandes de son entreprise (nécessaire pour la vue détail
-- d'un membre de son équipe côté "Mon équipe").
drop policy if exists orders_reseller_select_own on public.orders;
create policy orders_reseller_select_own on public.orders
  for select
  using (
    placed_by_profile_id = auth.uid()
    or (
      reseller_id = public.current_reseller_id()
      and exists (
        select 1 from public.reseller_contacts rc
        where rc.profile_id = auth.uid()
          and rc.reseller_id = orders.reseller_id
          and rc.is_primary
      )
    )
  );

drop policy if exists order_items_reseller_select_own on public.order_items;
create policy order_items_reseller_select_own on public.order_items
  for select
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id
        and (
          o.placed_by_profile_id = auth.uid()
          or (
            o.reseller_id = public.current_reseller_id()
            and exists (
              select 1 from public.reseller_contacts rc
              where rc.profile_id = auth.uid()
                and rc.reseller_id = o.reseller_id
                and rc.is_primary
            )
          )
        )
    )
  );

notify pgrst, 'reload schema';
