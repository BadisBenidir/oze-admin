-- Colonnes support pour le renvoi d'invitation et l'anti-spam (cooldown) sur
-- invite-reseller-contact : suivre si un compte a terminé son activation
-- (mot de passe défini) et quand la dernière invitation par email a été
-- envoyée, pour pouvoir la renvoyer proprement plutôt que d'échouer sur
-- "email déjà utilisé".

alter table public.profiles
  add column if not exists activated_at timestamptz,
  add column if not exists last_invited_at timestamptz;

notify pgrst, 'reload schema';
