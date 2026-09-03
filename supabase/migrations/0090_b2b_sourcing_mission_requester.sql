-- Ajoute le sous-compte précis (demandeur/bénéficiaire) d'une mission de
-- sourcing, en plus de reseller_id (l'entreprise) — voir 0089. Un admin peut
-- créer une mission sans préciser QUI dans l'entreprise l'a demandée
-- (contact principal implicite), donc nullable.
--
-- Référence public.profiles, jamais auth.users directement — même
-- convention que reseller_contacts.profile_id / shipments.requested_by_profile_id.
alter table public.b2b_sourcing_missions
  add column if not exists user_id uuid references public.profiles (id) on delete set null;

create index if not exists b2b_sourcing_missions_user_id_idx on public.b2b_sourcing_missions (user_id);

notify pgrst, 'reload schema';
