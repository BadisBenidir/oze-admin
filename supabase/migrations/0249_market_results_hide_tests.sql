-- ============================================================================
-- Résultats de ventes (0248) : exclut les articles de test (nom commençant
-- par le mot « test »), vendus 1 € pour essayer le paiement.
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
  if not (
    public.is_admin()
    or (
      exists (
        select 1
        from public.reseller_contacts rc
        join public.resellers r on r.id = rc.reseller_id
        where rc.profile_id = auth.uid() and r.status in ('active', 'discovery')
      )
      and not public.community_access_blocked(auth.uid())
    )
  ) then
    raise exception 'Accès réservé aux membres';
  end if;

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

revoke all on function public.get_market_results() from public, anon;
grant execute on function public.get_market_results() to authenticated;

notify pgrst, 'reload schema';
