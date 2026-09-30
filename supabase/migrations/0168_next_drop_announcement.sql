-- ============================================================================
-- Annonce du prochain drop côté revendeur (bandeau en haut du catalogue).
--
-- La table drops est réservée aux admins (RLS) : cette fonction n'expose que
-- ce qu'il faut pour l'annonce — date, titre, nombre de pièces, marques et
-- jusqu'à 4 photos (affichées floutées en teaser côté interface). Jamais les
-- prix ni les fiches : l'avant-première détaillée reste réservée aux contacts
-- can_preview_drops (b2b_catalog).
-- Réservée aux revendeurs actifs ou en découverte (current_reseller_id()).
-- ============================================================================

create or replace function public.get_next_drop_announcement()
returns table (
  drop_id uuid,
  title text,
  scheduled_at timestamptz,
  piece_count integer,
  brands text[],
  preview_images text[]
)
language sql
security definer
stable
set search_path = public
as $$
  with next_drop as (
    select d.*
    from public.drops d
    where d.status = 'planifie'
      and d.scheduled_at > now()
      and public.current_reseller_id() is not null
    order by d.scheduled_at asc
    limit 1
  ),
  pieces as (
    select p.id, p.images, p.main_image_index, b.name as brand_name
    from next_drop nd
    join public.products p on p.id = any(nd.product_ids)
    left join public.brands b on b.id = p.brand_id
  )
  select
    nd.id,
    nd.title,
    nd.scheduled_at,
    coalesce(array_length(nd.product_ids, 1), 0),
    coalesce((
      select array_agg(x.brand_name order by x.n desc, x.brand_name)
      from (
        select brand_name, count(*) as n
        from pieces
        where brand_name is not null
        group by brand_name
        order by count(*) desc, brand_name
        limit 4
      ) x
    ), array[]::text[]),
    coalesce((
      select array_agg(img)
      from (
        select coalesce(p.images ->> coalesce(p.main_image_index, 0), p.images ->> 0) as img
        from pieces p
        where jsonb_typeof(p.images) = 'array' and jsonb_array_length(p.images) > 0
        limit 4
      ) i
      where img is not null
    ), array[]::text[])
  from next_drop nd;
$$;

revoke all on function public.get_next_drop_announcement() from public, anon;
grant execute on function public.get_next_drop_announcement() to authenticated;

notify pgrst, 'reload schema';
