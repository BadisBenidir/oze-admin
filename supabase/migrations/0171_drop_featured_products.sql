-- ============================================================================
-- Pièces "vitrine" d'un drop : jusqu'à 4 articles choisis par l'admin (fiche
-- du drop), affichés NETS dans l'annonce du prochain drop côté revendeur.
-- Sans choix, l'annonce garde le teaser : les 4 premières photos, floutées.
--
-- get_next_drop_announcement (0168) gagne la colonne images_revealed —
-- changement du type de retour, d'où le drop function préalable.
-- ============================================================================

alter table public.drops add column if not exists featured_product_ids uuid[];

comment on column public.drops.featured_product_ids is
  'Jusqu''à 4 articles du drop affichés nets dans l''annonce revendeur (null = teaser flouté des 4 premières photos).';

drop function if exists public.get_next_drop_announcement();

create function public.get_next_drop_announcement()
returns table (
  drop_id uuid,
  title text,
  scheduled_at timestamptz,
  piece_count integer,
  brands text[],
  preview_images text[],
  images_revealed boolean
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
  shown as (
    select * from (
      select coalesce(p.images ->> coalesce(p.main_image_index, 0), p.images ->> 0) as img, p.pos as rank
      from featured p
      where (select count(*) from featured) > 0
      union all
      select coalesce(p.images ->> coalesce(p.main_image_index, 0), p.images ->> 0) as img, p.ord as rank
      from pieces p
      where (select count(*) from featured) = 0
    ) s
    where img is not null
    order by rank
    limit 4
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
    exists (select 1 from featured)
  from next_drop nd;
$$;

revoke all on function public.get_next_drop_announcement() from public, anon;
grant execute on function public.get_next_drop_announcement() to authenticated;

notify pgrst, 'reload schema';
