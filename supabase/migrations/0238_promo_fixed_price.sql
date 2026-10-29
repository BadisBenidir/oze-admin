-- ============================================================================
-- Codes promo Club : prix fixe pour le premier mois, puis un autre prix pour
-- les mois suivants (ex. 9,90 € le 1er mois puis 39,90 €/mois).
--   - discount_type 'fixed_price' : discount_value = prix du 1er mois (0 € =
--     1er mois offert), next_price = prix des mois suivants (vide = prix
--     normal du pass) ;
--   - au paiement (subscriptionPromo.ts) : coupon Stripe du 1er mois au
--     checkout, coupon « à vie » des mois suivants posé sur l'abonnement par
--     le webhook une fois le 1er mois payé.
-- ============================================================================

alter table public.club_promo_codes add column if not exists next_price numeric(10, 2)
  check (next_price is null or next_price >= 0);

alter table public.club_promo_codes drop constraint if exists club_promo_codes_discount_type_check;
alter table public.club_promo_codes add constraint club_promo_codes_discount_type_check
  check (discount_type in ('percentage', 'fixed_amount', 'fixed_price'));

alter table public.club_promo_codes drop constraint if exists club_promo_codes_discount_value_check;
alter table public.club_promo_codes add constraint club_promo_codes_discount_value_check
  check (discount_value > 0 or (discount_type = 'fixed_price' and discount_value >= 0));

notify pgrst, 'reload schema';
