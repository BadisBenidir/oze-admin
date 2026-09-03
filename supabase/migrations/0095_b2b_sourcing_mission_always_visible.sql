-- Décorrèle la visibilité de la MISSION (cartouche avance/budget) de celle
-- des PIÈCES sourcées. Avant cette migration, reseller_sourcing_missions
-- exigeait is_published_to_reseller = true pour renvoyer quoi que ce soit —
-- une mission tout juste créée (avance de 5000€ reçue, sourcing en cours)
-- restait donc totalement invisible au revendeur tant que l'admin n'avait
-- pas publié une première pièce. Le revendeur doit voir sa mission (et
-- savoir qu'elle est en cours) dès sa création ; seule la galerie des
-- pièces reste conditionnée à is_published_to_reseller (voir
-- reseller_sourcing_items, inchangée par cette migration).
--
-- La colonne is_published_to_reseller est désormais exposée dans cette vue
-- (simple booléen, aucune donnée financière) pour que le front revendeur
-- sache s'il doit afficher la galerie ou le message d'attente.
drop view if exists public.reseller_sourcing_missions;

create view public.reseller_sourcing_missions as
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
  m.created_at
from public.b2b_sourcing_missions m
where m.status != 'cancelled'
  and (m.reseller_id = public.current_reseller_id() or m.user_id = auth.uid());

grant select on public.reseller_sourcing_missions to authenticated;

notify pgrst, 'reload schema';
