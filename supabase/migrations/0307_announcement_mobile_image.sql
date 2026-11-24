-- ============================================================================
-- Actualités B2B (0305) :
--   - mobile_image_url : version téléphone de l'affiche (format portrait),
--     montrée à la place de l'image principale sur petit écran ;
--   - l'admin peut effacer les vues d'une affiche (« Réafficher à tout le
--     monde ») pour qu'elle revienne à la prochaine connexion.
-- ============================================================================

alter table public.b2b_announcements add column if not exists mobile_image_url text;

drop policy if exists b2b_announcement_views_admin_delete on public.b2b_announcement_views;
create policy b2b_announcement_views_admin_delete on public.b2b_announcement_views
  for delete using (public.is_admin());

notify pgrst, 'reload schema';
