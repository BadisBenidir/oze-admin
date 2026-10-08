-- ============================================================================
-- Codes promo des abonnements Club B2B : code utilisé et remise accordée sur
-- chaque facture d'abonnement (b2b_subscription_payments, 0185).
--
-- Alimenté par recordSubscriptionInvoice (webhook invoice.paid + rattrapage
-- sync-subscription-payments). Sert à l'écran admin « Codes promo Club » :
-- membres par code, CA encaissé, remises accordées.
-- promo_code = le code saisi (ex. BIENVENUE20), ou « coupon:<nom> » pour une
-- remise appliquée sans code depuis le Dashboard Stripe.
-- ============================================================================

alter table public.b2b_subscription_payments add column if not exists promo_code text;
alter table public.b2b_subscription_payments add column if not exists promotion_code_id text;
alter table public.b2b_subscription_payments add column if not exists discount_amount numeric(10, 2) not null default 0;

create index if not exists b2b_subscription_payments_promo_code_idx
  on public.b2b_subscription_payments (promo_code) where promo_code is not null;

notify pgrst, 'reload schema';
