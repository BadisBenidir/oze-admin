-- Le formulaire B2B utilise désormais un système de grades de luxe pour
-- l'état du produit (S, A, AB, B, BC, C, D) au lieu du sélecteur classique
-- (neuf/excellent/...). Les lettres A/AB/B/BC/C/D étaient déjà utilisées
-- ailleurs dans le code (Products.tsx affichait déjà un badge "État X" pour
-- ces valeurs), mais 'S' est nouveau : si une contrainte CHECK restreint les
-- valeurs de `products.condition`, on la recrée pour l'inclure. On repère la
-- contrainte dynamiquement (nom inconnu a priori) ; si elle n'existe pas, ce
-- bloc ne fait rien (colonne déjà en texte libre).

do $$
declare
  cname text;
begin
  select conname into cname
  from pg_constraint
  where conrelid = 'public.products'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%condition%';

  if cname is not null then
    execute format('alter table public.products drop constraint %I', cname);
    alter table public.products
      add constraint products_condition_check
      check (condition in ('neuf','excellent','very-good','good','fair','S','A','AB','B','BC','C','D'));
  end if;
exception when others then
  raise notice 'Impossible d''ajuster automatiquement la contrainte sur products.condition — vérifier manuellement si besoin.';
end $$;

notify pgrst, 'reload schema';
