-- ============================================================================
-- Suppression d'un produit depuis "Gestion des Produits" — ADMIN UNIQUEMENT.
--
-- Le bouton poubelle faisait un DELETE direct sur `products` depuis le
-- navigateur : sans policy DELETE admin sur cette table (créée hors
-- migrations), la RLS filtrait silencieusement la ligne — 0 ligne supprimée,
-- aucune erreur, rien ne se passait. Et un produit référencé ailleurs (ligne
-- de commande, cadeau fidélité...) ne peut de toute façon pas être supprimé
-- sans casser l'historique.
--
-- admin_delete_product : supprime le produit ; s'il est encore référencé
-- (violation de clé étrangère), il est ARCHIVÉ à la place ('archived' : sorti
-- du stock, des listes et des statistiques de stock, historique intact).
-- ============================================================================

create or replace function public.admin_delete_product(p_product_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Accès refusé';
  end if;

  perform 1 from public.products where id = p_product_id for update;
  if not found then
    raise exception 'Produit introuvable';
  end if;

  -- Un produit encore dans une commande active (même affiché "Brouillon") ne
  -- doit ni disparaître ni être archivé sous le nez du revendeur.
  if exists (
    select 1 from public.order_items where product_id = p_product_id and status = 'active'
  ) then
    raise exception 'Ce produit fait partie d''une commande B2B en cours — annulez d''abord l''article de la commande';
  end if;

  begin
    delete from public.products where id = p_product_id;
    return jsonb_build_object('deleted', true, 'archived', false);
  exception when foreign_key_violation then
    update public.products
    set status = 'archived',
        reserved_by_reseller_id = null,
        reserved_by_order_id = null,
        reserved_at = null
    where id = p_product_id;
    return jsonb_build_object('deleted', false, 'archived', true);
  end;
end;
$$;

revoke all on function public.admin_delete_product(uuid) from public, anon;
grant execute on function public.admin_delete_product(uuid) to authenticated;

notify pgrst, 'reload schema';
