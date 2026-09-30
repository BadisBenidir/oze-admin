-- ============================================================================
-- Liens d'avant-première (Discord, réseaux) : un admin génère un lien public
-- /avant-premiere/<token> qui montre à l'avance tout ou partie des pièces
-- d'un drop planifié ou d'une session d'enchères — sans compte. Le lien ne
-- donne accès à rien d'autre qu'à cette sélection : pas de fiche, pas de
-- panier, pas d'enchère ; prix affichés seulement si l'admin l'a choisi.
--
--   - item_ids null  → toutes les pièces du drop / de la session (y compris
--                      celles ajoutées après la création du lien) ;
--   - item_ids rempli → uniquement ces pièces (products.id pour un drop,
--                      auction_items.id pour une session).
-- ============================================================================

create table if not exists public.preview_links (
  id uuid primary key default gen_random_uuid(),
  token text not null unique default (
    replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
  ),
  label text,
  drop_id uuid references public.drops (id) on delete cascade,
  session_id uuid references public.auction_sessions (id) on delete cascade,
  item_ids uuid[],
  show_prices boolean not null default false,
  expires_at timestamptz,
  revoked_at timestamptz,
  view_count integer not null default 0,
  last_viewed_at timestamptz,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  constraint preview_links_one_target check ((drop_id is null) <> (session_id is null)),
  constraint preview_links_items_not_empty check (item_ids is null or array_length(item_ids, 1) > 0)
);

create index if not exists preview_links_drop_id_idx on public.preview_links (drop_id);
create index if not exists preview_links_session_id_idx on public.preview_links (session_id);

alter table public.preview_links enable row level security;

drop policy if exists preview_links_admin_all on public.preview_links;
create policy preview_links_admin_all on public.preview_links
  for all using (public.is_admin()) with check (public.is_admin());

----------------------------------------------------------------------------
-- get_preview_link : lecture publique (anon) d'un lien. SECURITY DEFINER :
-- drops/products/auction_items sont fermés à anon par le RLS, la fonction
-- ne renvoie que les colonnes d'aperçu. Lien inconnu, révoqué ou expiré →
-- { "status": "invalid" } (jamais de détail sur la raison). Chaque appel
-- valide incrémente le compteur de vues.
----------------------------------------------------------------------------
create or replace function public.get_preview_link(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
          'images', to_jsonb(coalesce(p.images, array[]::text[])),
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
      'show_prices', v_link.show_prices,
      'total_count', (select count(*) from public.auction_items ai where ai.session_id = s.id and ai.status <> 'cancelled'),
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', ai.id,
          'name', ai.title,
          'brand', ai.brand,
          'condition', ai.grade,
          'images', to_jsonb(coalesce(ai.images, array[]::text[])),
          'main_image_index', 0,
          'price', case when v_link.show_prices then ai.start_price end,
          'sold', ai.status = 'sold'
        ) order by ai.ends_at, ai.created_at)
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
$$;

revoke all on function public.get_preview_link(text) from public;
grant execute on function public.get_preview_link(text) to anon, authenticated;

notify pgrst, 'reload schema';
