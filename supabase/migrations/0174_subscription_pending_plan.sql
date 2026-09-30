-- ============================================================================
-- Abonnements Club B2B (0167) : passage du Pass Revendeur au Pass Drops à la
-- prochaine échéance (b2b-subscription, action "downgrade" — planning Stripe).
-- subscription_pending_plan mémorise le pass programmé pour l'afficher dans
-- « Mon abonnement » ; le webhook l'efface quand le changement s'applique,
-- b2b-subscription quand il est annulé.
-- ============================================================================

alter table public.resellers
  add column if not exists subscription_pending_plan text
  check (subscription_pending_plan is null or subscription_pending_plan in ('drops', 'revendeur'));

comment on column public.resellers.subscription_pending_plan is
  'Pass programmé pour la prochaine échéance (null = aucun changement prévu).';

notify pgrst, 'reload schema';
