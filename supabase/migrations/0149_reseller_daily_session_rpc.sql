-- ============================================================================
-- L'insert direct côté client dans reseller_daily_sessions (0125), protégé
-- par une policy RLS `profile_id = auth.uid()` en apparence correcte,
-- échoue systématiquement en production (403 "new row violates row-level
-- security policy") pour TOUS les revendeurs — la table reste à 0 ligne
-- malgré une présence temps réel qui fonctionne (canal Realtime distinct,
-- jamais concerné par cette RLS). Cause exacte non isolée malgré
-- vérification de la policy et de la correspondance profiles.id/auth.users.id
-- (identiques) — plutôt que de continuer à déboguer un insert direct fragile
-- déjà abandonné ailleurs dans ce projet pour la même classe de problème
-- (voir auction_bids, 0108 : "Un revendeur ne doit plus pouvoir insérer
-- directement... RLS reste activée sans policy INSERT... seule
-- place_auto_bid() (security definer, contourne la RLS) écrit désormais"),
-- on applique ici le même pattern éprouvé : une RPC security definer qui
-- lit auth.uid() elle-même et contourne entièrement la RLS.
-- ============================================================================

create or replace function public.log_reseller_daily_session()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;
  end if;
  insert into public.reseller_daily_sessions (profile_id, date)
  values (auth.uid(), current_date)
  on conflict (profile_id, date) do nothing;
end;
$$;

grant execute on function public.log_reseller_daily_session() to authenticated;

-- L'insert direct restait ouvert à 'authenticated' (0125) mais ne fonctionne
-- pas de façon fiable ; retiré au profit exclusif de la RPC ci-dessus.
revoke insert on public.reseller_daily_sessions from authenticated;

notify pgrst, 'reload schema';
