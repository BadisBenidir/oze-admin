-- ============================================================================
-- Archivage manuel d'un article depuis « Liste des Produits » — ADMIN.
--
-- Contrairement à admin_delete_product (0164), qui refuse un article présent
-- dans une commande en cours, l'archivage est toujours possible : seul le
-- statut de l'article change ('archived' : sorti du stock et des
-- statistiques). Les commandes, lignes de commande, factures et liens de
-- réservation restent intacts — l'historique et le suivi de la commande ne
-- bougent pas.
--
-- Pour qu'il ne puisse plus être acheté, l'article est aussi retiré des
-- paniers et d'un éventuel drop encore planifié.
--
-- Désarchivage : retour en brouillon ('draft-b2b' s'il a une référence B2B,
-- sinon 'draft').
-- ============================================================================

create or replace function public.admin_set_product_archived(p_product_id uuid, p_archived boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product record;
  v_in_active_order boolean;
  v_new_status text;
begin
  if not public.is_admin() then
    raise exception 'Accès refusé';
  end if;

  select id, status, b2b_reference into v_product from public.products where id = p_product_id for update;
  if not found then
    raise exception 'Produit introuvable';
  end if;

  v_in_active_order := exists (
    select 1 from public.order_items where product_id = p_product_id and status = 'active'
  );

  if p_archived then
    update public.products set status = 'archived' where id = p_product_id;
    delete from public.cart_items where product_id = p_product_id;
    update public.drops
    set product_ids = array_remove(product_ids, p_product_id)
    where status = 'planifie'
      and p_product_id = any(product_ids)
      and array_length(product_ids, 1) > 1;
    v_new_status := 'archived';
  else
    if v_product.status <> 'archived' then
      raise exception 'Ce produit n''est pas archivé';
    end if;
    v_new_status := case when v_product.b2b_reference is not null then 'draft-b2b' else 'draft' end;
    update public.products set status = v_new_status where id = p_product_id;
  end if;

  return jsonb_build_object('status', v_new_status, 'in_active_order', v_in_active_order);
end;
$$;

revoke all on function public.admin_set_product_archived(uuid, boolean) from public, anon;
grant execute on function public.admin_set_product_archived(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
