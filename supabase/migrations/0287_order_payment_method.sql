-- Moyen de paiement réel des commandes, pour la mention « Facture acquittée —
-- paiement par … » des factures (admin et storefront).
--
-- Avant : mention déduite à l'aveugle (« carte bancaire (Stripe) » écrit en
-- dur dans la facture du storefront ; « Stripe sinon wallet » dans l'admin),
-- fausse pour les commandes PayPal (ex. OZ-2026-5956, FA-2026-07-0001) et
-- les commandes de sourcing payées par virement.
--
--   - orders.payment_method : moyen saisi explicitement (nul par défaut) ;
--   - orders.payment_method_effective (champ calculé PostgREST) : la saisie,
--     sinon déduit des seules traces FIABLES du paiement (capture PayPal,
--     paiement Stripe, débit du portefeuille, avance de sourcing réglée par
--     virement). Aucune trace → null : la facture dit « Facture acquittée »
--     sans préciser, rien n'est inventé.
--   - invoices.rectifies_* : facture rectificative d'une facture émise
--     (numéro et date de l'originale, motif) — une facture émise ne se
--     modifie jamais.

alter table public.orders add column if not exists payment_method text
  check (payment_method is null or payment_method in ('card', 'paypal', 'transfer', 'wallet', 'mixed', 'cash'));

comment on column public.orders.payment_method is
  'Moyen de paiement saisi explicitement (card = carte Stripe, paypal, transfer = virement, wallet = portefeuille revendeur, mixed = portefeuille + carte, cash). Nul : voir payment_method_effective.';

create or replace function public.payment_method_effective(o public.orders)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    o.payment_method,
    case
      when o.paypal_capture_id is not null then 'paypal'
      when exists (
        select 1 from public.b2b_sourcing_missions m
        where m.order_id = o.id and m.payment_method ilike '%virement%'
      ) then 'transfer'
      when o.stripe_payment_intent_id is not null and exists (
        select 1 from public.wallet_transactions w
        where w.order_id = o.id and w.type = 'achat' and w.status = 'success'
      ) then 'mixed'
      when o.stripe_payment_intent_id is not null then 'card'
      when exists (
        select 1 from public.wallet_transactions w
        where w.order_id = o.id and w.type = 'achat' and w.status = 'success'
      ) then 'wallet'
      else null
    end
  );
$$;

grant execute on function public.payment_method_effective(public.orders) to authenticated, service_role;

-- OZ-2026-5956 (FA-2026-07-0001) : payée par PayPal.
update public.orders set payment_method = 'paypal' where order_number = 'OZ-2026-5956';

alter table public.invoices add column if not exists rectifies_invoice_number text;
alter table public.invoices add column if not exists rectifies_invoice_date date;
alter table public.invoices add column if not exists rectification_reason text;

comment on column public.invoices.rectifies_invoice_number is
  'Facture rectificative : numéro de la facture émise qu''elle rectifie (ex. FA-2026-07-0001, numérotation storefront, ou FAC-…).';

notify pgrst, 'reload schema';
