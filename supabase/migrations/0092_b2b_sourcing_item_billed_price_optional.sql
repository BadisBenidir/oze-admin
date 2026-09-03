-- billed_price (prix de vente prévu) n'est plus saisi dans le formulaire
-- d'ajout d'une pièce sourcée — seul cost_price (prix d'achat réel) compte
-- désormais, c'est lui qui s'impute sur allocated_cost_budget (voir 0091).
-- On relâche la contrainte NOT NULL plutôt que de supprimer la colonne :
-- l'historique déjà saisi reste intact, et rien n'empêche de la
-- réutiliser plus tard si le suivi de marge par pièce redevient utile.
alter table public.b2b_sourcing_items alter column billed_price drop not null;

comment on column public.b2b_sourcing_items.billed_price is
  'Prix de vente prévu (optionnel, non saisi depuis le formulaire actuel) — jamais utilisé pour la consommation du budget, voir cost_price.';

notify pgrst, 'reload schema';
