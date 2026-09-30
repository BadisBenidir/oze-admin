-- ============================================================================
-- Pièces "vitrine" d'un drop : jusqu'à 4 articles choisis par l'admin (fiche
-- du drop), affichés NETS et en grand dans l'annonce du prochain drop côté
-- revendeur, suivis sur toute la largeur du bandeau par d'autres pièces du
-- drop, floutées (teaser). Sans choix : uniquement des photos floutées.
--
-- get_next_drop_announcement (0168) : preview_images = photos nettes puis
-- floutées (16 max), nouvelle colonne revealed_count = nombre de photos
-- nettes en tête — changement du type de retour, d'où le drop function.
-- ============================================================================

alter table public.drops add column if not exists featured_product_ids uuid[];

comment on column public.drops.featured_product_ids is
  'Jusqu''à 4 articles du drop affichés nets dans l''annonce revendeur (null = uniquement le teaser flouté).';

drop function if exists public.get_next_drop_announcement();

create function public.get_next_drop_announcement()
returns table (
  drop_id uuid,
  title text,
  scheduled_at timestamptz,
  piece_count integer,
  brands text[],
  preview_images text[],
  revealed_count integer
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
    select p.id, p.images, p.main_image_index, b.name as brand_name, x.ord
    from next_drop nd
    cross join lateral unnest(nd.product_ids) with ordinality as x(pid, ord)
    join public.products p on p.id = x.pid
    left join public.brands b on b.id = p.brand_id
  ),
  -- Vitrine choisie (dans l'ordre du choix), restreinte aux articles encore dans le drop.
  featured as (
    select pc.*, f.pos
    from next_drop nd
    cross join lateral unnest(nd.featured_product_ids) with ordinality as f(pid, pos)
    join pieces pc on pc.id = f.pid
  ),
  -- Photos nettes : les pièces vitrine (4 max), dans l'ordre du choix.
  revealed as (
    select img, pos as rank
    from (
      select coalesce(f.images ->> coalesce(f.main_image_index, 0), f.images ->> 0) as img, f.pos
      from featured f
    ) s
    where img is not null
    order by pos
    limit 4
  ),
  -- Photos floutées à la suite : les autres pièces du drop (12 max).
  teased as (
    select img, 1000 + ord as rank
    from (
      select coalesce(p.images ->> coalesce(p.main_image_index, 0), p.images ->> 0) as img, p.ord
      from pieces p
      where not exists (select 1 from featured f where f.id = p.id)
    ) s
    where img is not null
    order by ord
    limit 12
  ),
  shown as (
    select * from revealed
    union all
    select * from teased
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
    coalesce((select array_agg(img order by rank) from shown), array[]::text[]),
    (select count(*)::integer from revealed)
  from next_drop nd;
$$;

revoke all on function public.get_next_drop_announcement() from public, anon;
grant execute on function public.get_next_drop_announcement() to authenticated;

notify pgrst, 'reload schema';
