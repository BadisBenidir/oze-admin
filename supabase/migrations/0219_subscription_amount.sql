-- ============================================================================
-- Prix mensuel réellement payé par chaque abonné Club (hors remise).
--
-- Hausse des prix publics (Pass Drops 39,90 € → 49,90 €, Pass Revendeur
-- 69,90 € → 79,90 €) : les abonnés déjà inscrits gardent leur ancien tarif
-- (ancien prix Stripe, voir _shared/clubPlans.ts). Leur espace et l'admin
-- affichent donc le prix de LEUR abonnement, tenu à jour par le webhook
-- (customer.subscription.*) et b2b-subscription.
-- Abonnés existants : tous à l'ancien tarif de leur pass.
-- ============================================================================

alter table public.resellers add column if not exists subscription_amount numeric(10, 2);

update public.resellers
set subscription_amount = case subscription_plan when 'drops' then 39.90 when 'revendeur' then 69.90 end
where account_type = 'subscriber' and subscription_plan is not null and subscription_amount is null;

notify pgrst, 'reload schema';
