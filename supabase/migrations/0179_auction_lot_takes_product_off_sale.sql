-- ============================================================================
-- Enchères : une pièce mise en lot sort TOUJOURS de la vente (correctif 0173).
--
-- sync_auction_product_status (0173) ne basculait en 'auction-b2b' qu'une
-- pièce en brouillon ('draft'/'draft-b2b'). Une pièce liée à un lot alors
-- qu'elle était déjà en vente au catalogue ('for-sale-b2b') ou programmée
-- dans un drop ('drop-b2b') restait achetable : elle a été vendue au
-- catalogue (Session 04, Boulogne 35 M51260) tout en restant affichée en
-- enchère.
--
-- Désormais, à la liaison à un lot en cours ou adjugé :
--   - pièce déjà vendue, réservée, archivée ou cadeau → refus explicite ;
--   - brouillon, en vente B2B ou programmée dans un drop → 'auction-b2b',
--     retirée des paniers et du drop planifié (s'il contient d'autres pièces).
-- Le reste (libération à la sortie du lot, commande à l'adjudication) est
-- inchangé.
-- ============================================================================

create or replace function public.sync_auction_product_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  -- Ancienne fiche libérée : lot supprimé, fiche remplacée/détachée, ou lot
  -- sorti des statuts engagés (non vendu). Un lot annulé fixe lui-même le
  -- statut du produit (0156).
  if tg_op in ('UPDATE', 'DELETE') and old.product_id is not null
     and (tg_op = 'DELETE'
          or new.product_id is distinct from old.product_id
          or new.status not in ('active', 'sold')) then
    update public.products
    set status = case when b2b_reference is not null then 'draft-b2b' else 'draft' end
    where id = old.product_id and status = 'auction-b2b';
  end if;

  if tg_op in ('INSERT', 'UPDATE') and new.product_id is not null and new.status in ('active', 'sold')
     and (tg_op = 'INSERT' or new.product_id is distinct from old.product_id or old.status not in ('active', 'sold')) then
    select status into v_status from public.products where id = new.product_id for update;

    if v_status like 'sold-%' or v_status in ('reserved-b2b', 'archived', 'cadeau', 'cadeau-attribue', 'cadeau-livre') then
      raise exception 'Cette pièce n''est plus disponible (statut : %) — elle ne peut pas être mise en enchère', v_status;
    end if;

    if v_status in ('draft', 'draft-b2b', 'for-sale-b2b', 'drop-b2b') then
      update public.products set status = 'auction-b2b' where id = new.product_id;
      -- Plus achetable au catalogue : retirée des paniers et d'un drop encore planifié.
      delete from public.cart_items where product_id = new.product_id;
      update public.drops
      set product_ids = array_remove(product_ids, new.product_id)
      where status = 'planifie'
        and new.product_id = any(product_ids)
        and array_length(product_ids, 1) > 1;
    end if;
  end if;

  return coalesce(new, old);
end;
$$;

notify pgrst, 'reload schema';
