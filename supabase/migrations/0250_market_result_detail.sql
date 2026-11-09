-- ============================================================================
-- Résultats de ventes (0248) : fiche détaillée d'une vente au clic, façon
-- « market price detail » — toutes les photos, référence, état, remarques
-- (description / défauts), matière, couleurs. Mêmes règles d'accès que
-- get_market_results, jamais de donnée acheteur.
-- p_source : 'auction' (auction_items.id) ou 'drop' (order_items.id).
-- ============================================================================

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

revoke all on function public.get_market_result_detail(text, uuid) from public, anon;
grant execute on function public.get_market_result_detail(text, uuid) to authenticated;

notify pgrst, 'reload schema';
