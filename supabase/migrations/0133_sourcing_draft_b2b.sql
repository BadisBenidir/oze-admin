-- ============================================================================
-- "Sourcing sur mesure" (AddSourcingItemModal, "Depuis le stock") doit aussi
-- proposer les articles 'draft-b2b' (0130, créés directement depuis Produits
-- B2B), pas seulement les brouillons classiques — déjà corrigé côté client.
--
-- Mais sync_sourcing_item_product_status (0122) ne reconnaissait que 'draft'
-- pour la transition vers 'sourced-b2b' au moment de la liaison : un article
-- 'draft-b2b' lié à une pièce de sourcing n'aurait donc jamais basculé en
-- 'sourced-b2b' (resterait affiché comme un brouillon B2B ordinaire dans
-- "Produits B2B", sans qu'on sache qu'il est déjà engagé sur une mission).
--
-- Et à la déliaison, le trigger repassait TOUJOURS en 'draft' — correct tant
-- que 'draft-b2b' n'existait pas, mais aurait fait perdre le statut B2B d'un
-- article qui en avait un avant sa liaison. La distinction se fait sur
-- b2b_reference : jamais nul pour un article qui a un jour été 'draft-b2b'
-- (généré dès la création par generate_b2b_reference, 0130), toujours nul
-- pour un brouillon générique classique.
-- ============================================================================

create or replace function public.sync_sourcing_item_product_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.product_id is not null and (tg_op = 'INSERT' or old.product_id is distinct from new.product_id) then
    update public.products
    set status = 'sourced-b2b'
    where id = new.product_id and status in ('draft', 'draft-b2b');
  end if;

  if tg_op = 'UPDATE' and old.product_id is not null and old.product_id is distinct from new.product_id then
    update public.products
    set status = case when b2b_reference is not null then 'draft-b2b' else 'draft' end
    where id = old.product_id and status = 'sourced-b2b';
  end if;

  return new;
end;
$$;

create or replace function public.sync_sourcing_item_product_status_on_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.product_id is not null then
    update public.products
    set status = case when b2b_reference is not null then 'draft-b2b' else 'draft' end
    where id = old.product_id and status = 'sourced-b2b';
  end if;
  return old;
end;
$$;

-- ----------------------------------------------------------------------------
-- reseller_validate_sourcing_mission (0122) : le contrôle de disponibilité
-- accepte déjà 'draft'/'sourced-b2b' — un article 'draft-b2b' lié à une
-- mission est déjà normalisé en 'sourced-b2b' par le trigger ci-dessus au
-- moment de la liaison, donc aucun changement nécessaire ici.
-- ----------------------------------------------------------------------------

notify pgrst, 'reload schema';
