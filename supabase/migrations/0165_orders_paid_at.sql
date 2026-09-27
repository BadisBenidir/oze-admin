-- ============================================================================
-- orders.paid_at : date réelle du paiement d'une commande.
--
-- Jusqu'ici, une commande ne gardait que payment_status ('pending'/'paid') :
-- impossible de savoir si un lot d'enchère a été payé avant ou après son
-- payment_deadline (0137). AuctionsAdmin.tsx affichait donc "Payé" même pour
-- un paiement arrivé en retard.
--
-- Un trigger renseigne paid_at au passage à 'paid', quel que soit le chemin
-- (pay_auction_order_with_wallet, confirm_auction_order_payment,
-- confirm_b2b_payment, marquage manuel admin…) sans toucher à ces fonctions.
--
-- Rattrapage : pour les commandes déjà payées par solde, on reprend la date
-- de la wallet_transaction 'achat' liée. Les paiements carte passés n'ont
-- aucune date en base — paid_at reste NULL (affiché simplement "Payé").
-- ============================================================================

alter table public.orders add column if not exists paid_at timestamptz;

comment on column public.orders.paid_at is
  'Date du passage à payment_status = ''paid'' (trigger orders_set_paid_at). NULL pour les commandes payées avant 0165 sans trace datée.';

create or replace function public.orders_set_paid_at()
returns trigger
language plpgsql
as $$
begin
  if new.payment_status = 'paid' and new.paid_at is null
     and (tg_op = 'INSERT' or old.payment_status is distinct from 'paid') then
    new.paid_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists orders_set_paid_at on public.orders;
create trigger orders_set_paid_at
  before insert or update of payment_status on public.orders
  for each row execute function public.orders_set_paid_at();

update public.orders o
set paid_at = wt.first_at
from (
  select order_id, min(created_at) as first_at
  from public.wallet_transactions
  where type = 'achat' and status = 'success' and order_id is not null
  group by order_id
) wt
where wt.order_id = o.id
  and o.payment_status = 'paid'
  and o.paid_at is null;

notify pgrst, 'reload schema';
