-- ============================================================================
-- Gestion des drops B2B au-delà du cycle planifié/publié : renommer,
-- fusionner, et réassigner des articles entre drops, y compris pour des
-- drops déjà clôturés/passés (`publie`/`annule`) — le hook useDrops.ts
-- existant restreint updateDrop/cancelDrop à `status='planifie'`
-- uniquement, donc ces actions passent par de nouvelles RPCs dédiées plutôt
-- que par cette restriction.
-- ============================================================================

create or replace function public.admin_rename_drop(p_drop_id uuid, p_title text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Accès refusé';
  end if;

  update public.drops set title = nullif(trim(p_title), '') where id = p_drop_id;

  if not found then
    raise exception 'Drop introuvable';
  end if;

  return jsonb_build_object('drop_id', p_drop_id);
end;
$$;

grant execute on function public.admin_rename_drop(uuid, text) to authenticated;

create or replace function public.admin_merge_drops(p_source_drop_id uuid, p_target_drop_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source_products uuid[];
  v_target_products uuid[];
  v_merged uuid[];
begin
  if not public.is_admin() then
    raise exception 'Accès refusé';
  end if;
  if p_source_drop_id = p_target_drop_id then
    raise exception 'Impossible de fusionner un drop avec lui-même';
  end if;

  select product_ids into v_source_products from public.drops where id = p_source_drop_id for update;
  select product_ids into v_target_products from public.drops where id = p_target_drop_id for update;
  if v_source_products is null or v_target_products is null then
    raise exception 'Drop introuvable';
  end if;

  select array_agg(distinct pid) into v_merged
  from unnest(v_target_products || v_source_products) as pid;

  update public.drops set product_ids = v_merged where id = p_target_drop_id;
  update public.drops set status = 'annule' where id = p_source_drop_id;

  return jsonb_build_object('target_drop_id', p_target_drop_id, 'product_count', array_length(v_merged, 1));
end;
$$;

grant execute on function public.admin_merge_drops(uuid, uuid) to authenticated;

create or replace function public.admin_reassign_drop_product(p_product_id uuid, p_from_drop_id uuid, p_to_drop_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from_products uuid[];
  v_to_products uuid[];
begin
  if not public.is_admin() then
    raise exception 'Accès refusé';
  end if;
  if p_from_drop_id = p_to_drop_id then
    raise exception 'Les deux drops doivent être différents';
  end if;

  select product_ids into v_from_products from public.drops where id = p_from_drop_id for update;
  select product_ids into v_to_products from public.drops where id = p_to_drop_id for update;
  if v_from_products is null or v_to_products is null then
    raise exception 'Drop introuvable';
  end if;
  if not (p_product_id = any(v_from_products)) then
    raise exception 'Cet article n''appartient pas au drop source';
  end if;

  -- La contrainte drops_product_ids_not_empty lève elle-même une erreur
  -- claire si ce retrait viderait le drop source — pas de contournement ici,
  -- l'admin doit alors annuler ce drop plutôt que d'en retirer le dernier
  -- article.
  update public.drops
  set product_ids = array_remove(v_from_products, p_product_id)
  where id = p_from_drop_id;

  update public.drops
  set product_ids = (select array_agg(distinct pid) from unnest(v_to_products || array[p_product_id]) as pid)
  where id = p_to_drop_id;

  return jsonb_build_object('from_drop_id', p_from_drop_id, 'to_drop_id', p_to_drop_id);
end;
$$;

grant execute on function public.admin_reassign_drop_product(uuid, uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
