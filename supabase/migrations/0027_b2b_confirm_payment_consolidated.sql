-- Consolidation de confirm_b2b_payment : les commandes B2B ne se créaient
-- plus après paiement (webhook silencieusement en échec). Cause probable :
-- les migrations 0020/0021/0024/0025/0026 remplacent chacune la fonction par
-- une nouvelle signature (paramètres en plus). Si l'une d'elles n'a pas été
-- exécutée (ou dans le désordre), Postgres peut se retrouver avec PLUSIEURS
-- versions de la fonction en même temps (une ancienne signature jamais
-- supprimée + une nouvelle créée à côté) — PostgREST ne sait alors plus
-- laquelle choisir pour l'appel du webhook, et échoue silencieusement à
-- l'étape même de la RPC, avant toute écriture en base.
--
-- Ce script est idempotent et sûr à rejouer : il supprime EXPLICITEMENT
-- toutes les signatures historiques possibles de la fonction (quelle que
-- soit la migration réellement appliquée avant), s'assure que toutes les
-- colonnes nécessaires existent, puis recrée la version finale unique.

-- 1. Colonnes nécessaires, ajoutées progressivement par les migrations
--    précédentes — idempotent, sans effet si déjà présentes.
alter table public.orders add column if not exists insurance_cost numeric not null default 0;
alter table public.orders add column if not exists insured_value numeric not null default 0;
alter table public.orders add column if not exists grouped_with_order_id uuid references public.orders (id);
alter table public.orders add column if not exists discount_rate numeric not null default 0;
alter table public.orders add column if not exists discount_amount numeric not null default 0;
alter table public.order_items add column if not exists insured boolean not null default false;
alter table public.order_items add column if not exists insurance_cost numeric not null default 0;

-- 2. Suppression de TOUTES les signatures historiques possibles, pour
--    éliminer tout risque d'overload ambigu quelle que soit la ou les
--    migrations réellement passées avant celle-ci.
drop function if exists public.confirm_b2b_payment(uuid, uuid[], jsonb, jsonb, text, text, text);
drop function if exists public.confirm_b2b_payment(uuid, uuid[], jsonb, jsonb, text, text, text, uuid);
drop function if exists public.confirm_b2b_payment(uuid, uuid[], jsonb, jsonb, text, text, text, uuid, numeric);
drop function if exists public.confirm_b2b_payment(uuid, uuid[], jsonb, jsonb, text, text, text, uuid, numeric, uuid[], numeric);
drop function if exists public.confirm_b2b_payment(uuid, uuid[], jsonb, jsonb, text, text, text, uuid, numeric, uuid[], numeric, uuid);
drop function if exists public.confirm_b2b_payment(uuid, uuid[], jsonb, jsonb, text, text, text, uuid, numeric, uuid[], numeric, uuid, numeric);
drop function if exists public.confirm_b2b_payment(uuid, uuid[], jsonb, jsonb, text, text, text, uuid, numeric, uuid[], numeric, uuid, numeric, numeric, numeric);

-- 3. Version finale unique.
create function public.confirm_b2b_payment(
  p_reseller_id uuid,
  p_product_ids uuid[],
  p_shipping_address jsonb,
  p_billing_address jsonb,
  p_stripe_session_id text,
  p_stripe_payment_intent_id text,
  p_email text,
  p_placed_by_profile_id uuid default null,
  p_shipping_cost numeric default 0,
  p_insured_product_ids uuid[] default '{}',
  p_insurance_cost numeric default 0,
  p_grouped_with_order_id uuid default null,
  p_insured_value numeric default 0,
  p_discount_rate numeric default 0,
  p_discount_amount numeric default 0
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
    discount_rate, discount_amount, currency,
    payment_status, shipping_address, billing_address, reseller_id, placed_by_profile_id,
    order_channel, approval_status, approved_at, stripe_session_id, stripe_payment_intent_id,
    grouped_with_order_id
  ) values (
    v_order_number, p_email, 'confirmed',
    v_subtotal - coalesce(p_discount_amount, 0) + coalesce(p_shipping_cost, 0) + coalesce(p_insurance_cost, 0),
    v_subtotal, coalesce(p_shipping_cost, 0), coalesce(p_insurance_cost, 0), coalesce(p_insured_value, 0),
    coalesce(p_discount_rate, 0), coalesce(p_discount_amount, 0), 'EUR',
    'paid', p_shipping_address, coalesce(p_billing_address, p_shipping_address), p_reseller_id, p_placed_by_profile_id,
    'b2b', 'approved', now(), p_stripe_session_id, p_stripe_payment_intent_id,
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

  return jsonb_build_object(
    'order_id', v_order_id, 'already_processed', false, 'subtotal', v_subtotal,
    'unavailable_ids', to_jsonb(coalesce(v_unavailable_ids, array[]::uuid[]))
  );
end;
$$;

revoke all on function public.confirm_b2b_payment(uuid, uuid[], jsonb, jsonb, text, text, text, uuid, numeric, uuid[], numeric, uuid, numeric, numeric, numeric) from public;
revoke all on function public.confirm_b2b_payment(uuid, uuid[], jsonb, jsonb, text, text, text, uuid, numeric, uuid[], numeric, uuid, numeric, numeric, numeric) from authenticated;

notify pgrst, 'reload schema';
