-- ============================================================================
-- Liens d'aperçu (preview_links, 0169) du CATALOGUE en vente B2B, en plus des
-- drops et des sessions d'enchères : page publique (sans compte) avec les
-- pièces actuellement en vente — liste toujours à jour (item_ids null) — ou
-- une sélection, prix affichés ou non, expiration / révocation comme les autres.
-- ============================================================================

alter table public.preview_links add column if not exists catalog boolean not null default false;

alter table public.preview_links drop constraint if exists preview_links_one_target;
alter table public.preview_links add constraint preview_links_one_target
  check ((drop_id is not null)::int + (session_id is not null)::int + (catalog)::int = 1);

create or replace function public.get_preview_link(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_link public.preview_links;
  v_result jsonb;
begin
  select * into v_link
  from public.preview_links
  where token = p_token
    and revoked_at is null
    and (expires_at is null or expires_at > now());

  if v_link.id is null then
    return jsonb_build_object('status', 'invalid');
  end if;

  update public.preview_links
  set view_count = view_count + 1, last_viewed_at = now()
  where id = v_link.id;

  -- Catalogue (0229) : pièces actuellement en vente B2B (toujours à jour),
  -- ou la sélection du lien (une pièce vendue depuis reste affichée « vendue »).
  if v_link.catalog then
    select jsonb_build_object(
      'status', 'ok',
      'kind', 'catalog',
      'label', v_link.label,
      'title', 'Catalogue',
      'starts_at', now(),
      'ends_at', null,
      'event_status', 'live',
      'show_prices', v_link.show_prices,
      'total_count', count(*),
      'items', coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'brand', b.name,
        'condition', p.condition,
        'images', coalesce(p.images, '[]'::jsonb),
        'main_image_index', coalesce(p.main_image_index, 0),
        'price', case when v_link.show_prices then p.sale_price end,
        'sold', p.status like 'sold-%'
      ) order by p.created_at desc), '[]'::jsonb)
    )
    into v_result
    from public.products p
    left join public.brands b on b.id = p.brand_id
    where case
      when v_link.item_ids is null then p.status = 'for-sale-b2b'
      else p.id = any(v_link.item_ids) and (p.status = 'for-sale-b2b' or p.status like 'sold-%')
    end;
    return coalesce(v_result, jsonb_build_object('status', 'invalid'));
  end if;

  if v_link.drop_id is not null then
    select jsonb_build_object(
      'status', 'ok',
      'kind', 'drop',
      'label', v_link.label,
      'title', d.title,
      'starts_at', d.scheduled_at,
      'ends_at', null,
      'event_status', d.status,
      'show_prices', v_link.show_prices,
      'total_count', coalesce(array_length(d.product_ids, 1), 0),
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', p.id,
          'name', p.name,
          'brand', b.name,
          'condition', p.condition,
          'images', coalesce(p.images, '[]'::jsonb),
          'main_image_index', coalesce(p.main_image_index, 0),
          'price', case when v_link.show_prices then p.sale_price end,
          'sold', p.status like 'sold-%'
        ) order by x.ord)
        from unnest(d.product_ids) with ordinality as x(pid, ord)
        join public.products p on p.id = x.pid
        left join public.brands b on b.id = p.brand_id
        where v_link.item_ids is null or p.id = any(v_link.item_ids)
      ), '[]'::jsonb)
    )
    into v_result
    from public.drops d
    where d.id = v_link.drop_id and d.status <> 'annule';
  else
    select jsonb_build_object(
      'status', 'ok',
      'kind', 'auction',
      'label', v_link.label,
      'title', s.title,
      'starts_at', s.starts_at,
      'ends_at', s.ends_at,
      'event_status', s.status,
      'show_prices', v_link.show_prices or coalesce(v_link.price_mode, 'none') <> 'none',
      'price_mode', coalesce(v_link.price_mode, case when v_link.show_prices then 'start' else 'none' end),
      'total_count', (select count(*) from public.auction_items ai where ai.session_id = s.id and ai.status <> 'cancelled'),
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', ai.id,
          'name', ai.title,
          'brand', ai.brand,
          'condition', ai.grade,
          'images', to_jsonb(coalesce(ai.images, array[]::text[])),
          'main_image_index', 0,
          'price', case when coalesce(v_link.price_mode, case when v_link.show_prices then 'start' else 'none' end) in ('start', 'both') then ai.start_price end,
          'final_price', case when coalesce(v_link.price_mode, 'none') in ('final', 'both') and ai.status = 'sold' then ai.current_price end,
          'sold', ai.status = 'sold'
        ) order by ai.position nulls last, ai.ends_at, ai.created_at)
        from public.auction_items ai
        where ai.session_id = s.id
          and ai.status <> 'cancelled'
          and (v_link.item_ids is null or ai.id = any(v_link.item_ids))
      ), '[]'::jsonb)
    )
    into v_result
    from public.auction_sessions s
    where s.id = v_link.session_id;
  end if;

  return coalesce(v_result, jsonb_build_object('status', 'invalid'));
end;
$function$;

notify pgrst, 'reload schema';
