-- ============================================================================
-- État d'un lot d'enchère synchronisé avec la fiche produit.
--
-- auction_items.grade était copié de products.condition à la création du lot
-- (format « Grade B ») : modifier l'état de la fiche produit ne changeait ni
-- la page Enchères des revendeurs ni les liens d'aperçu (get_preview_link).
-- Désormais, changer l'état d'un produit met à jour ses lots encore actifs
-- (jamais un lot vendu ou annulé : historique figé). Rattrapage des lots
-- actifs dont l'état diffère déjà de la fiche.
-- ============================================================================

create or replace function public.auction_grade_from_condition(p_condition text)
returns text
language sql
immutable
as $$
  select case
    when p_condition is null or btrim(p_condition) = '' then null
    when p_condition ~ '^(S|A|AB|B|BC|C|D)$' then 'Grade ' || p_condition
    else p_condition
  end;
$$;

create or replace function public.sync_auction_lot_grade()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.condition is distinct from old.condition then
    update public.auction_items
    set grade = public.auction_grade_from_condition(new.condition)
    where product_id = new.id
      and status = 'active'
      and public.auction_grade_from_condition(new.condition) is not null;
  end if;
  return new;
end;
$$;

drop trigger if exists products_sync_auction_lot_grade on public.products;
create trigger products_sync_auction_lot_grade
  after update of condition on public.products
  for each row execute function public.sync_auction_lot_grade();

-- Rattrapage : lots actifs dont l'état ne correspond plus à la fiche.
update public.auction_items ai
set grade = public.auction_grade_from_condition(p.condition)
from public.products p
where p.id = ai.product_id
  and ai.status = 'active'
  and public.auction_grade_from_condition(p.condition) is not null
  and ai.grade is distinct from public.auction_grade_from_condition(p.condition);
