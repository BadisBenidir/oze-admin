-- Portail revendeur "Sourcing sur mesure" (pro.ozeparis.com) : un admin
-- publie une mission pour la rendre visible au revendeur concerné, sans
-- jamais exposer la marge ni les coûts d'achat internes.

alter table public.b2b_sourcing_missions
  add column if not exists is_published_to_reseller boolean not null default false,
  add column if not exists published_at timestamptz;

comment on column public.b2b_sourcing_missions.is_published_to_reseller is
  'Basculé par un admin ("Afficher au revendeur") — condition d''accès des vues reseller_sourcing_* ci-dessous.';

-- Le revendeur n'accède JAMAIS directement à b2b_sourcing_missions /
-- b2b_sourcing_items (RLS admin-only, voir 0089) : il passe exclusivement
-- par ces deux vues, qui n'exposent QUE les colonnes autorisées — jamais
-- allocated_cost_budget, cost_price ni billed_price. Même principe déjà
-- établi pour b2b_catalog (0003), qui exclut purchase_price des revendeurs.
--
-- Visibilité : la mission doit être publiée ET appartenir à l'entreprise du
-- revendeur connecté (current_reseller_id(), défini en 0011 — couvre tous
-- les sous-comptes de l'entreprise) OU avoir été explicitement demandée par
-- ce profil précis (user_id = auth.uid(), au cas où ce profil ne serait
-- plus rattaché à l'entreprise au moment de la lecture).
create or replace view public.reseller_sourcing_missions as
select
  m.id,
  m.reseller_id,
  m.user_id,
  m.title,
  m.advance_amount,
  m.paid_at,
  m.status,
  m.published_at
from public.b2b_sourcing_missions m
where m.is_published_to_reseller = true
  and (m.reseller_id = public.current_reseller_id() or m.user_id = auth.uid());

grant select on public.reseller_sourcing_missions to authenticated;

-- Les pièces annulées (jamais réellement affectées au client) restent
-- internes — non exposées ici, même une fois la mission publiée.
create or replace view public.reseller_sourcing_items as
select
  i.id,
  i.mission_id,
  i.title,
  i.brand,
  i.photos,
  i.status,
  i.created_at
from public.b2b_sourcing_items i
join public.b2b_sourcing_missions m on m.id = i.mission_id
where m.is_published_to_reseller = true
  and i.status != 'cancelled'
  and (m.reseller_id = public.current_reseller_id() or m.user_id = auth.uid());

grant select on public.reseller_sourcing_items to authenticated;

notify pgrst, 'reload schema';
