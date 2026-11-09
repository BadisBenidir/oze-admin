-- ============================================================================
-- Landing b2b.ozeparis.com : section « Ventes récentes » — aperçu public des
-- dernières pièces vendues (drops et enchères) pour inviter les visiteurs à
-- rejoindre le Club et voir tous les résultats (get_market_results, membres).
--
-- get_public_market_highlights(p_limit) : accessible sans connexion (anon),
-- renvoie le nombre total de ventes et les p_limit dernières (max 24), mêmes
-- règles que get_market_results (0248/0249 : hors test, sourcing, cadeaux,
-- annulations). Aucune donnée acheteur.
-- ============================================================================

create or replace function public.get_public_market_highlights(p_limit integer default 12)
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  with sales(id, source, title, brand, category, condition, image, start_price, final_price, sold_at) as (
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
      and coalesce(p.name, oi.product_snapshot ->> 'name', '') !~* '^\s*test\M'
  )
  select jsonb_build_object(
    'total', (select count(*) from sales),
    'items', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.sold_at desc)
      from (
        select id, source, title, brand, category, condition, image, start_price, final_price, sold_at
        from sales
        where image is not null
        order by sold_at desc
        limit least(greatest(coalesce(p_limit, 12), 1), 24)
      ) s
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.get_public_market_highlights(integer) from public;
grant execute on function public.get_public_market_highlights(integer) to anon, authenticated;

notify pgrst, 'reload schema';
