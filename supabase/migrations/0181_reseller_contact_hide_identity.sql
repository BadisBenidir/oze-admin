-- ============================================================================
-- Espace revendeur : masquer l'identité affichée en haut de l'écran (nom,
-- email et entreprise de l'en-tête), compte par compte — réglé par l'admin
-- depuis la fiche du revendeur (sous-comptes). Utile pour les captures
-- d'écran ou le partage d'écran (lives, Discord...). Aucun effet sur les
-- données : seul l'en-tête de l'espace pro n'affiche plus ces informations.
-- ============================================================================

alter table public.reseller_contacts
  add column if not exists hide_identity boolean not null default false;

comment on column public.reseller_contacts.hide_identity is
  'true = nom, email et entreprise masqués dans l''en-tête de l''espace revendeur (réglé par l''admin).';

notify pgrst, 'reload schema';
