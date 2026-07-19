-- Adresse et téléphone individuels par profil revendeur, saisis à
-- l'activation du compte (/accept-invite). Jusqu'ici seule l'adresse de
-- l'ENTREPRISE (table resellers, gérée par un admin OZË) existait ; celle-ci
-- est propre à chaque personne et vise, à terme, à préremplir "Livrer à mon
-- entreprise" dans le checkout avec les coordonnées du sous-compte connecté
-- plutôt que l'adresse générique de la société.
-- profiles.phone existe déjà (migration 0017).

alter table public.profiles add column if not exists address text;
alter table public.profiles add column if not exists city text;
alter table public.profiles add column if not exists postal_code text;
alter table public.profiles add column if not exists country text;

notify pgrst, 'reload schema';
