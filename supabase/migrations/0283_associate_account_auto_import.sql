-- Compte courant d'associé (0279) : mise à jour automatique depuis Qonto.
--
-- À chaque NOUVELLE transaction synchronisée (qonto-sync, 7 h / 19 h ou
-- bouton « Actualiser » de Comptabilité) :
--   - débit vers « Badis Benidir » / « Badis Benidir CA » → retrait ;
--   - crédit de « M. BADIS BENIDIR » / « MONSIEUR BENIDIR BADIS » /
--     « EI- BENIDIR BADIS » d'au moins 100 € → apport.
-- Les petits crédits (< 100 €) restent à classer à la main (ambigus :
-- remboursements, tests de paiement…). La transaction est marquée
-- rapprochée (matched / other) : elle n'est jamais importée en charge.
-- Les transactions déjà présentes ne sont pas reprises (seed 0279).

create or replace function public.associate_classify_bank_transaction(p_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bank_transactions;
  v_type text;
  v_label text;
begin
  select * into b from public.bank_transactions where id = p_id;
  if not found or b.matched_type is not null
     or exists (select 1 from public.associate_account_entries a where a.bank_transaction_id = b.id)
     or exists (select 1 from public.expenses e where e.bank_transaction_id = b.id) then
    return null;
  end if;
  v_label := upper(coalesce(b.label, ''));

  if b.side = 'debit' and v_label ~ '^BADIS BENIDIR( CA)?$' then
    v_type := 'retrait';
  elsif b.side = 'credit' and b.amount >= 100
        and (v_label in ('M. BADIS BENIDIR', 'MONSIEUR BENIDIR BADIS') or v_label like 'EI- BENIDIR BADIS%') then
    v_type := 'apport';
  else
    return null;
  end if;

  insert into public.associate_account_entries (entry_date, type, label, amount, bank_transaction_id, notes)
  values ((coalesce(b.settled_at, b.emitted_at, now()) at time zone 'Europe/Paris')::date, v_type,
          case when v_type = 'apport' then 'Apport en compte courant' else 'Retrait associé' end,
          b.amount, b.id, 'Qonto : ' || b.label || ' (classé automatiquement)');

  update public.bank_transactions
  set reconciliation_status = 'matched',
      matched_type = 'other',
      note = 'Compte courant d''associé : ' || case when v_type = 'apport' then 'apport' else 'retrait' end || ' (automatique)'
  where id = b.id;
  return v_type;
end;
$$;

revoke all on function public.associate_classify_bank_transaction(uuid) from public, anon, authenticated;

create or replace function public.bank_transactions_associate_auto()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.associate_classify_bank_transaction(new.id);
  return null;
exception when others then
  -- Jamais bloquer la synchro Qonto.
  return null;
end;
$$;

drop trigger if exists bank_transactions_associate_auto on public.bank_transactions;
create trigger bank_transactions_associate_auto
  after insert on public.bank_transactions
  for each row execute function public.bank_transactions_associate_auto();
