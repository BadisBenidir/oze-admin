-- Fonction utilitaire : force la déconnexion de toutes les sessions actives
-- d'un utilisateur (appelée après réinitialisation de son mot de passe, pour
-- qu'une session déjà ouverte sur un autre appareil ne reste pas valide avec
-- l'ancien mot de passe). Le schéma `auth` n'est pas exposé via l'API
-- PostgREST : cette fonction SECURITY DEFINER (créée par le rôle migrateur,
-- qui a accès à `auth` sur Supabase) sert de porte d'entrée contrôlée.
-- Réservée au service_role (voir revoke/grant ci-dessous) : jamais
-- appelable directement par un revendeur ou un admin depuis le client, donc
-- uniquement invocable depuis une Edge Function déjà passée par ses propres
-- vérifications d'autorisation.
create or replace function public.revoke_user_sessions(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  -- refresh_tokens.user_id est historiquement du texte côté GoTrue ; on le
  -- supprime explicitement en plus de sessions (dont la suppression cascade
  -- normalement dessus) pour ne pas dépendre d'une contrainte FK précise.
  delete from auth.refresh_tokens where user_id = target_user_id::text;
  delete from auth.sessions where user_id = target_user_id;
end;
$$;

revoke all on function public.revoke_user_sessions(uuid) from public;
revoke all on function public.revoke_user_sessions(uuid) from authenticated;
revoke all on function public.revoke_user_sessions(uuid) from anon;
grant execute on function public.revoke_user_sessions(uuid) to service_role;

notify pgrst, 'reload schema';
