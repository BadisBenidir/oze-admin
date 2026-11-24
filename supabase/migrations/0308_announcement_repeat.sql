-- ============================================================================
-- Actualités B2B : affiche répétée.
--   repeat_every_hours null = une seule fois par personne (comportement 0305) ;
--   sinon l'affiche revient à la connexion dès que la dernière vue date d'au
--   moins ce nombre d'heures. La vue est mise à jour (seen_at) à chaque
--   fermeture : chaque membre peut mettre à jour sa propre ligne.
-- ============================================================================

alter table public.b2b_announcements add column if not exists repeat_every_hours integer
  check (repeat_every_hours is null or repeat_every_hours > 0);

drop policy if exists b2b_announcement_views_own_update on public.b2b_announcement_views;
create policy b2b_announcement_views_own_update on public.b2b_announcement_views
  for update to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid());

update public.b2b_announcements set repeat_every_hours = 1 where id = '2bc70a78-c294-46c7-9c8d-6f44b40ac456';

notify pgrst, 'reload schema';
