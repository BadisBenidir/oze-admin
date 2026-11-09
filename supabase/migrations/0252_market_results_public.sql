-- ============================================================================
-- Résultats de ventes ouverts au public : la page complète (liste, filtres,
-- fiche détaillée) est accessible depuis la landing b2b.ozeparis.com sans
-- compte. get_market_results (0249) et get_market_result_detail (0250)
-- perdent leur contrôle « membres uniquement » et sont ouvertes à anon.
-- Toujours aucune donnée acheteur : article, photos, état, prix, date.
-- ============================================================================

create or replace function public.get_market_results()
returns table (
  id uuid,
  source text,
  title text,
  brand text,
  category text,
  condition text,
  image text,
  start_price numeric,
  final_price numeric,
  sold_at timestamptz
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin

  return query
  select ai.id, 'auction'::text, ai.title, ai.brand, c.name::text, ai.grade::text,
         coalesce(ai.images[1], p.images ->> coalesce(p.main_image_index, 0), p.images ->> 0),
         ai.start_price, ai.current_price, ai.ends_at
  from public.auction_items ai
  left join public.products p on p.id = ai.product_id
  left join public.categories c on c.id = p.category_id
  where ai.status = 'sold' and ai.cancelled_at is null

  union all

  select oi.id, 'drop'::text,
         coalesce(p.name, oi.product_snapshot ->> 'name')::text,
         b.name::text, c.name::text, p.condition::text,
         coalesce(p.images ->> coalesce(p.main_image_index, 0), p.images ->> 0, oi.product_snapshot -> 'images' ->> 0),
         null::numeric, oi.unit_price, coalesce(o.paid_at, o.created_at)
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  left join public.products p on p.id = oi.product_id
  left join public.brands b on b.id = p.brand_id
  left join public.categories c on c.id = p.category_id
  where o.order_channel = 'b2b'
    and o.payment_status = 'paid'
    and o.status not in ('cancelled', 'canceled')
    and oi.status = 'active'
    and not coalesce(oi.is_loyalty_gift, false)
    and not coalesce(o.is_sourcing_fulfillment, false)
    and o.order_number not like 'SRC-%'
    and not exists (select 1 from public.auction_items a where a.order_id = o.id)
    and coalesce(oi.unit_price, 0) > 0
    -- Articles de test (nom « test… ») : jamais affichés.
    and coalesce(p.name, oi.product_snapshot ->> 'name', '') !~* '^\s*test\M'

  order by 10 desc;
end;
$$;

revoke all on function public.get_market_results() from public;
grant execute on function public.get_market_results() to anon, authenticated;

create or replace function public.get_market_result_detail(p_source text, p_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_product_id uuid;
  v_images jsonb;
  v_snapshot jsonb;
  v_lot text;
  p record;
begin

  if p_source = 'auction' then
    select ai.product_id, to_jsonb(ai.images), s.title
      into v_product_id, v_images, v_lot
    from public.auction_items ai
    left join public.auction_sessions s on s.id = ai.session_id
    where ai.id = p_id and ai.status = 'sold' and ai.cancelled_at is null;
  elsif p_source = 'drop' then
    select oi.product_id, oi.product_snapshot
      into v_product_id, v_snapshot
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where oi.id = p_id and o.order_channel = 'b2b' and o.payment_status = 'paid';
  else
    raise exception 'Source invalide';
  end if;

  if v_product_id is null and v_snapshot is null and v_images is null then
    return null;
  end if;

  select pr.images, pr.description, pr.defects, pr.material, pr.colors, pr.genre,
         coalesce(pr.b2b_reference, pr.reference) as ref
    into p
  from public.products pr
  where pr.id = v_product_id;

  return jsonb_build_object(
    'images', coalesce(
      case when jsonb_array_length(coalesce(v_images, '[]'::jsonb)) > 0 then v_images end,
      case when jsonb_typeof(p.images) = 'array' then p.images end,
      v_snapshot -> 'images',
      '[]'::jsonb
    ),
    'reference', p.ref,
    'description', p.description,
    'defects', p.defects,
    'material', p.material,
    'colors', p.colors,
    'genre', p.genre,
    'session', v_lot
  );
end;
$$;

revoke all on function public.get_market_result_detail(text, uuid) from public;
grant execute on function public.get_market_result_detail(text, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
