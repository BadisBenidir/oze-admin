-- ============================================================================
-- Enchères : grade des lots recopié EXACTEMENT depuis la fiche produit.
--
-- L'ajout d'un lot (AuctionItemFormModal) arrondissait l'état de la fiche à
-- 3 paliers (A/B/C) : une pièce BC apparaissait « Grade C », une AB
-- « Grade B ». Le formulaire propose désormais les 7 grades (S, A, AB, B,
-- BC, C, D) ; ici, les lots déjà créés et liés à une fiche avec un grade
-- lettré reprennent ce grade exact.
-- ============================================================================

update public.auction_items ai
set grade = 'Grade ' || p.condition
from public.products p
where p.id = ai.product_id
  and p.condition in ('S', 'A', 'AB', 'B', 'BC', 'C', 'D')
  and ai.grade is distinct from 'Grade ' || p.condition;
