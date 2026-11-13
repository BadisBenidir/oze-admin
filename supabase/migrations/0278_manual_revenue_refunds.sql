-- Comptabilité : remboursements clients hors plateforme (avoirs sans commande
-- d'origine), en montant négatif dans « Autres revenus » (0275) : ils
-- réduisent le CA du mois du débit Qonto, comme un avoir.
--
-- Trois virements sortants Qonto exclus des charges (0276) étaient des
-- remboursements à des clients. Aucune commande ni autre revenu d'origine
-- trouvé (aucun profil, revendeur, commande ou revenu au nom de « millielux »
-- ou « Maeli » avant juillet-août 2026) : origine à préciser.
--   31/07/2026 millielux 90,00 € · 04/08/2026 Maeli 99,00 € · 12/08/2026 millielux 90,00 €
-- Le débit Qonto est relié au remboursement (matched / other) et la ligne de
-- charge exclue créée par l'import (0276) est supprimée.

alter table public.manual_revenues drop constraint if exists manual_revenues_category_check;
alter table public.manual_revenues
  add constraint manual_revenues_category_check
  check (category in ('vente', 'prestation', 'autre', 'remboursement'));

alter table public.manual_revenues drop constraint if exists manual_revenues_amount_check;
alter table public.manual_revenues
  add constraint manual_revenues_amount_check
  check ((category = 'remboursement' and amount < 0) or (category <> 'remboursement' and amount > 0));

with refunds (bank_transaction_id) as (
  values
    ('ae50b039-23bc-4f6f-acbb-7d5a6533b7cf'::uuid),
    ('413847dc-9e90-43b5-829b-28914dd58c0b'::uuid),
    ('2d196b80-ce3f-48c5-b562-c778d0aeb027'::uuid)
),
tx as (
  select b.*
  from public.bank_transactions b
  join refunds r on r.bank_transaction_id = b.id
  where b.side = 'debit'
    and not exists (select 1 from public.manual_revenues m where m.bank_transaction_id = b.id)
),
ins as (
  insert into public.manual_revenues
    (revenue_date, client_name, label, amount, category, payment_method, qonto_transaction_id, bank_transaction_id, notes)
  select (tx.settled_at at time zone 'Europe/Paris')::date, tx.label, 'Remboursement client', -tx.amount, 'remboursement', 'virement',
         tx.qonto_transaction_id, tx.id, 'Remboursement client – origine à préciser'
  from tx
  returning bank_transaction_id
),
del as (
  delete from public.expenses e
  using ins
  where e.bank_transaction_id = ins.bank_transaction_id and e.review_status = 'excluded'
  returning e.id
)
update public.bank_transactions b
set reconciliation_status = 'matched',
    matched_type = 'other',
    matched_expense_id = null,
    note = 'Remboursement client (avoir hors plateforme) : ' || b.label
from ins
where b.id = ins.bank_transaction_id;

notify pgrst, 'reload schema';
