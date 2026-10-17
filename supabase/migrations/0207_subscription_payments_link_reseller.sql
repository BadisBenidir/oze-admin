-- ============================================================================
-- Paiements d'abonnement sans compte (« Compte inconnu » dans Codes promo Club).
--
-- La première facture d'un abonné est payée (webhook invoice.paid →
-- recordSubscriptionInvoice) AVANT que son compte revendeur soit créé par
-- l'inscription (b2b-signup / checkout.session.completed) : à ce moment-là
-- aucun resellers ne porte encore son stripe_customer_id ni son
-- stripe_subscription_id, et b2b_subscription_payments.reseller_id reste
-- null — pour toujours, rien ne le rattachait ensuite.
--
-- 1. Rattrapage des paiements déjà orphelins.
-- 2. Trigger : dès qu'un compte reçoit (ou change) son client / abonnement
--    Stripe, ses paiements orphelins lui sont rattachés.
-- ============================================================================

update public.b2b_subscription_payments p
set reseller_id = r.id
from public.resellers r
where p.reseller_id is null
  and (
    (p.stripe_subscription_id is not null and r.stripe_subscription_id = p.stripe_subscription_id)
    or (p.stripe_customer_id is not null and r.stripe_customer_id = p.stripe_customer_id)
  );

create or replace function public.link_orphan_subscription_payments()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.stripe_customer_id is null and new.stripe_subscription_id is null then
    return new;
  end if;

  update public.b2b_subscription_payments
  set reseller_id = new.id
  where reseller_id is null
    and (
      (new.stripe_subscription_id is not null and stripe_subscription_id = new.stripe_subscription_id)
      or (new.stripe_customer_id is not null and stripe_customer_id = new.stripe_customer_id)
    );
  return new;
end;
$$;

drop trigger if exists resellers_link_orphan_subscription_payments on public.resellers;
create trigger resellers_link_orphan_subscription_payments
after insert or update of stripe_customer_id, stripe_subscription_id on public.resellers
for each row execute function public.link_orphan_subscription_payments();

notify pgrst, 'reload schema';
