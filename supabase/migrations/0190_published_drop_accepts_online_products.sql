-- ============================================================================
-- Drop publié : accepter aussi les pièces déjà mises en ligne à la main
-- ('for-sale-b2b'), en plus des brouillons (0189). Elles gardent leur statut
-- (déjà en vente) ; les brouillons passent en vente. Une pièce déjà dans un
-- autre drop (planifié ou publié) est refusée, pour ne jamais la compter deux fois.
-- ============================================================================

create or replace function public.admin_add_products_to_published_drop(p_drop_id uuid, p_product_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_drop record;
  v_eligible uuid[];
begin
  if not public.is_admin() then
    raise exception 'Accès refusé';
  end if;

  select id, status, product_ids into v_drop from public.drops where id = p_drop_id for update;
  if v_drop.id is null then
    raise exception 'Drop introuvable';
  end if;
  if v_drop.status <> 'publie' then
    raise exception 'Ce drop n''est pas publié : modifiez-le directement';
  end if;

  select array_agg(p.id) into v_eligible
  from public.products p
  where p.id = any(p_product_ids)
    and p.status in ('draft', 'draft-b2b', 'for-sale-b2b')
    and p.id <> all (coalesce(v_drop.product_ids, array[]::uuid[]))
    and not exists (
      select 1 from public.drops d
      where d.status in ('planifie', 'publie') and p.id = any(d.product_ids)
    )
    and not exists (
      select 1 from public.b2b_sourcing_items si
      where si.product_id = p.id and si.status <> 'cancelled'
    );

  if v_eligible is null then
    raise exception 'Aucun article éligible (brouillon ou déjà en vente B2B, hors autre drop)';
  end if;

  update public.products set status = 'for-sale-b2b' where id = any(v_eligible) and status <> 'for-sale-b2b';
  update public.drops set product_ids = coalesce(product_ids, array[]::uuid[]) || v_eligible where id = p_drop_id;

  return jsonb_build_object('added_count', array_length(v_eligible, 1));
end;
$$;

revoke all on function public.admin_add_products_to_published_drop(uuid, uuid[]) from public, anon;
grant execute on function public.admin_add_products_to_published_drop(uuid, uuid[]) to authenticated;

notify pgrst, 'reload schema';
