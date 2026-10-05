-- ============================================================================
-- Inscription Club B2B (0175) : création du compte après paiement.
--
-- auth.admin.createUser({ password_hash }) est refusé sur ce projet : aucun
-- compte n'était créé après un paiement réussi (page bloquée sur « Création
-- de votre espace… »). Le compte est désormais créé avec un mot de passe
-- temporaire aléatoire, puis le mot de passe choisi à l'inscription (déjà
-- haché bcrypt, jamais stocké en clair) est posé ici directement.
--
-- Réservée au service role (Edge Functions) : aucun client ne peut l'appeler.
-- ============================================================================

create or replace function public.set_auth_user_password_hash(p_user_id uuid, p_password_hash text)
returns void
language plpgsql
security definer
set search_path = auth, public
as $$
begin
  if p_password_hash is null or p_password_hash !~ '^\$2[aby]\$\d{2}\$' then
    raise exception 'Hash bcrypt invalide';
  end if;
  update auth.users
  set encrypted_password = p_password_hash,
      updated_at = now()
  where id = p_user_id;
  if not found then
    raise exception 'Utilisateur introuvable';
  end if;
end;
$$;

revoke all on function public.set_auth_user_password_hash(uuid, text) from public, anon, authenticated;
grant execute on function public.set_auth_user_password_hash(uuid, text) to service_role;
