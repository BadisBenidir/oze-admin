-- ============================================================================
-- Numéro de référence fournisseur (Aucnet/EcoRing/Autre) sur une fiche
-- produit — remplace le champ "Poids" dans le formulaire de création
-- (CreateProduct.tsx), qui ne sert nulle part au calcul d'expédition
-- (aucune référence à products.weight dans les intégrations Sendcloud de ce
-- dépôt) : la colonne `weight` elle-même reste inchangée pour ne pas casser
-- son affichage existant (ProductDetail.tsx, useProducts.ts,
-- useB2BCatalog.ts) sur les fiches déjà créées.
--
-- source_platform est dérivé du format de source_reference au moment de la
-- saisie (voir detectSourcePlatform, CreateProduct.tsx), pas recalculé en
-- base : stocké tel quel pour un affichage/filtrage simples sans redupliquer
-- la regex côté SQL.
--
-- Purement additif, nullable, sans backfill : n'affecte aucune fiche
-- existante, seulement les nouvelles saisies.
-- ============================================================================

alter table public.products
  add column if not exists source_reference text,
  add column if not exists source_platform text check (source_platform in ('Aucnet', 'EcoRing', 'Autre'));

comment on column public.products.source_reference is
  'Numéro de référence de la pièce chez le fournisseur (ex: Aucnet "879-35749", EcoRing "2260006536516") — saisi à la création, remplace le champ poids dans le formulaire.';
comment on column public.products.source_platform is
  'Plateforme source déduite du format de source_reference (Aucnet: XXX-XXXXX ; EcoRing: numérique pur ; sinon Autre).';

notify pgrst, 'reload schema';
