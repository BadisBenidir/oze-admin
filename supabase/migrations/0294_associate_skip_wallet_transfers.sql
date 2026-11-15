-- Compte courant d'associé (0283) : un virement de Badis portant une
-- référence de rechargement de portefeuille (OZE-R-…, 0292) est une
-- recharge de SON portefeuille membre, pas un apport en compte courant —
-- il n'est plus classé automatiquement en apport.

CREATE OR REPLACE FUNCTION public.associate_classify_bank_transaction(p_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
        and (v_label in ('M. BADIS BENIDIR', 'MONSIEUR BENIDIR BADIS') or v_label like 'EI- BENIDIR BADIS%')
        and upper(coalesce(b.raw->>'reference', '') || ' ' || coalesce(b.raw->>'note', '')) !~ 'OZ[EË][ -]*R[ -]*[0-9]' then
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
$function$
;
