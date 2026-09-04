-- Numéro de référence de mission de sourcing, généré automatiquement à la
-- création et destiné à servir de numéro de facture dans l'export
-- comptable (Journal des Ventes) — voir useSalesJournalExport.ts, qui
-- utilisait jusqu'ici le titre libre de la mission (m.title) comme
-- "N° Commande / Facture", faute de mieux.
--
-- Format volontairement différent des références existantes pour rester
-- identifiable au premier coup d'œil dans un export comptable :
--   B2B      : B2B-YYYYMMDDHHMMSS-XXXX (voir 0004_b2b_rpcs.sql et suivants)
--   Web      : généré hors de ce repo (storefront), format inconnu ici
--   Sourcing : SRC-YYYY-NNNNN (compteur global séquentiel, jamais remis à
--              zéro chaque année — une vraie remise à zéro annuelle façon
--              séquence de facturation légale serait un chantier à part).
create sequence if not exists public.b2b_sourcing_mission_reference_seq start with 1;

alter table public.b2b_sourcing_missions
  add column if not exists reference text unique;

create or replace function public.set_b2b_sourcing_mission_reference()
returns trigger
language plpgsql
as $$
begin
  if new.reference is null then
    new.reference := 'SRC-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.b2b_sourcing_mission_reference_seq')::text, 5, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists set_b2b_sourcing_mission_reference on public.b2b_sourcing_missions;
create trigger set_b2b_sourcing_mission_reference
  before insert on public.b2b_sourcing_missions
  for each row
  execute function public.set_b2b_sourcing_mission_reference();

-- Rétro-attribution pour les missions déjà créées avant cette migration
-- (sinon reference resterait null pour elles) — dans l'ordre chronologique
-- de création, pour que le numéro le plus bas corresponde à la mission la
-- plus ancienne.
do $$
declare
  rec record;
begin
  for rec in
    select id, created_at from public.b2b_sourcing_missions where reference is null order by created_at
  loop
    update public.b2b_sourcing_missions
    set reference = 'SRC-' || to_char(rec.created_at, 'YYYY') || '-' || lpad(nextval('public.b2b_sourcing_mission_reference_seq')::text, 5, '0')
    where id = rec.id;
  end loop;
end $$;

-- Exposée au revendeur aussi (simple numéro de référence, aucune donnée
-- financière) — ajout en fin de liste de colonnes, seule forme autorisée
-- par CREATE OR REPLACE VIEW sans DROP (voir 0095 pour l'historique de
-- cette vue).
create or replace view public.reseller_sourcing_missions as
select
  m.id,
  m.reseller_id,
  m.user_id,
  m.title,
  m.advance_amount,
  m.paid_at,
  m.status,
  m.is_published_to_reseller,
  m.published_at,
  m.created_at,
  m.reference
from public.b2b_sourcing_missions m
where m.status != 'cancelled'
  and (m.reseller_id = public.current_reseller_id() or m.user_id = auth.uid());

grant select on public.reseller_sourcing_missions to authenticated;

notify pgrst, 'reload schema';
