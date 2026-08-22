-- ============================================================================
-- Diagnostic temporaire — supprimé par la migration suivante. Vérifie les
-- policies RLS réellement actives sur `profiles` (certaines sont gérées
-- hors des migrations de ce dépôt, via le Dashboard Supabase, par ex. la
-- policy "un utilisateur lit sa propre ligne" — voir commentaire de
-- 0019_profiles_reseller_teammate_select.sql) avant d'ajouter le join
-- shipments -> profiles (sous-compte demandeur) à la Vue Demandes de
-- livraison, pour confirmer qu'un admin peut bien lire n'importe quel
-- profil.
-- ============================================================================

create or replace function public.debug_profiles_rls()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'rls_enabled', (select relrowsecurity from pg_class where relname = 'profiles' and relnamespace = 'public'::regnamespace),
    'policies', (
      select jsonb_agg(jsonb_build_object('policy', policyname, 'cmd', cmd, 'using', qual))
      from pg_policies
      where schemaname = 'public' and tablename = 'profiles'
    )
  );
$$;

grant execute on function public.debug_profiles_rls() to service_role;

notify pgrst, 'reload schema';
