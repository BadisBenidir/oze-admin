-- ============================================================================
-- Drops : interdire l'annulation en libre-service des articles d'un drop.
--
-- Cas d'usage : après un drop, OZË applique des promotions sur les pièces
-- restantes — un revendeur ne doit pas pouvoir annuler son achat (remboursé
-- en crédit, pièce remise en vente) pour racheter la même pièce moins cher.
-- Vérifié par l'Edge Function cancel-my-b2b-order-item (seul chemin
-- d'annulation côté revendeur) ; l'admin peut toujours annuler.
-- ============================================================================

alter table public.drops
  add column if not exists lock_reseller_cancellation boolean not null default false;

comment on column public.drops.lock_reseller_cancellation is
  'true = les revendeurs ne peuvent pas annuler eux-mêmes les articles de ce drop (admin uniquement).';

-- Drop 7 (publié le 30/09/2026) : promotions prévues sur les pièces restantes.
update public.drops set lock_reseller_cancellation = true where id = 'fa72b6e3-58e4-4dcc-8db5-92fb57bbc410';

notify pgrst, 'reload schema';
