-- Débits Qonto encore « en attente » (paiement carte pas encore débité, 1 à
-- 3 jours) : qonto-sync les récupère désormais (avant : seulement les
-- débités, d'où des charges bloquées à quelques jours). L'import des charges
-- les prend aussi, mais jamais un paiement refusé ou annulé (declined /
-- reversed), ni une empreinte carte à 0 €. Même fonction que 0276, seules
-- ces conditions changent.

CREATE OR REPLACE FUNCTION public.accounting_import_bank_expenses()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  t record;
  v_who text;
  v_cat text;
  v_ignore text;
  v_expense uuid;
  n_charges int := 0;
  n_review int := 0;
  n_ignored int := 0;
begin
  if not public.accounting_is_owner() then
    raise exception 'Accès refusé.';
  end if;

  for t in
    select b.*
    from public.bank_transactions b
    where b.side = 'debit'
      and b.reconciliation_status = 'unmatched'
      and b.matched_type is null
      and b.matched_expense_id is null
      and coalesce(b.qonto_status, 'completed') in ('completed', 'pending')
      and b.amount > 0
      and not exists (select 1 from public.expenses e where e.bank_transaction_id = b.id)
    order by coalesce(b.settled_at, b.emitted_at)
  loop
    v_who := upper(coalesce(nullif(t.counterparty_name, ''), t.label, ''));
    v_cat := null;
    v_ignore := null;

    -- À ne pas compter en charges.
    if t.operation_type = 'transfer' and v_who ~ '^OZ[EË] PARIS' then
      v_ignore := 'Virement vers le compte EUR externe (paiement OGATE, déjà dans le coût d''achat produits)';
    elsif v_who ~ 'RESERVE' then
      v_ignore := 'Virement interne (compte Reserve)';
    elsif v_who ~ 'WISE EUROPE' then
      v_ignore := 'Transfert Wise remboursé';
    elsif v_who ~ 'SENDCLOUD|SNDCLD' then
      v_ignore := 'Sendcloud : déjà compté via les factures Sendcloud';
    elsif t.operation_type = 'transfer' and v_who ~ '^BADIS BENIDIR' then
      v_ignore := 'Retrait de l''associé (pas une charge)';
    -- Règles de catégorie.
    elsif v_who ~ 'IWG' then
      v_cat := 'Locaux';
    elsif v_who ~ 'ENTRUPY' then
      v_cat := 'Authentification';
    elsif v_who ~ 'DHL|CHRONOPOST|MONDIAL RELAY' then
      v_cat := 'Logistique hors Sendcloud';
    elsif t.operation_type = 'qonto_fee' or v_who ~ '^QONTO' or v_who ~ '^WISE' then
      v_cat := 'Frais bancaires';
    elsif v_who ~ 'ANTHROPIC|CLAUDE|SUPABASE|GOOGLE CLOUD|APPLE\.COM' then
      v_cat := 'Logiciels & IA';
    elsif v_who ~ 'FACEBK|META|VISTAPRINT' then
      v_cat := 'Marketing';
    elsif v_who ~ 'FREE MOBILE' then
      v_cat := 'Télécom';
    elsif v_who ~ '^TOTAL|APRR|VINCI|AUTOROUTES|ESCOTA|SNCF' or (v_who ~ '^UBER' and v_who !~ 'EATS') then
      v_cat := 'Déplacements';
    end if;

    if v_ignore is not null then
      update public.bank_transactions set reconciliation_status = 'ignored', note = v_ignore where id = t.id;
      n_ignored := n_ignored + 1;
      continue;
    end if;

    insert into public.expenses (label, category, amount, spent_at, notes, bank_transaction_id, review_status)
    values (
      coalesce(nullif(t.label, ''), 'Débit Qonto'),
      v_cat,
      t.amount,
      coalesce(t.settled_at, t.emitted_at, now())::date,
      'Import Qonto',
      t.id,
      case when v_cat is null then 'to_review' else 'validated' end
    )
    returning id into v_expense;

    if v_cat is null then
      -- À vérifier : la transaction reste « à rapprocher » tant qu'elle n'est pas classée.
      update public.bank_transactions set matched_expense_id = v_expense where id = t.id;
      n_review := n_review + 1;
    else
      update public.bank_transactions
      set reconciliation_status = 'matched', matched_type = 'expense', matched_expense_id = v_expense
      where id = t.id;
      n_charges := n_charges + 1;
    end if;
  end loop;

  return jsonb_build_object('charges', n_charges, 'to_review', n_review, 'ignored', n_ignored);
end;
$function$
;
