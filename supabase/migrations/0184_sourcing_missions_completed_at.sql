-- ============================================================================
-- Sourcing sur mesure : date de clôture d'une mission.
--
-- En comptabilité, l'avance d'une mission n'entre en CA qu'une fois la
-- mission terminée — via la commande créée quand le revendeur VALIDE la
-- mission. Une mission clôturée directement par l'admin (sans validation)
-- n'avait pas de commande : elle disparaissait des chiffres (ni CA, ni
-- avance en cours). Le module comptable la compte désormais comme une vente
-- B2B à sa date de clôture (useAccountingRawData), d'où cette colonne.
--
--   - completed_at : renseignée automatiquement au passage en 'completed',
--     effacée si la mission est rouverte ;
--   - missions déjà terminées : date du jour (clôtures récentes).
-- ============================================================================

alter table public.b2b_sourcing_missions add column if not exists completed_at timestamptz;

create or replace function public.set_sourcing_mission_completed_at()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    new.completed_at := coalesce(new.completed_at, now());
  elsif new.status <> 'completed' then
    new.completed_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists sourcing_missions_completed_at on public.b2b_sourcing_missions;
create trigger sourcing_missions_completed_at
before update of status on public.b2b_sourcing_missions
for each row execute function public.set_sourcing_mission_completed_at();

update public.b2b_sourcing_missions
set completed_at = now()
where status = 'completed' and completed_at is null;

notify pgrst, 'reload schema';
