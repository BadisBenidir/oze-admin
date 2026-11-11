-- ============================================================================
-- Comptabilité : charges externes et résultat net.
--
-- A. Autres revenus (0275) reliés à leur transaction Qonto
--    (manual_revenues.bank_transaction_id ; transaction « matched / other »).
--
-- B. Charges (table expenses existante) :
--    - expenses.bank_transaction_id : débit Qonto d'origine (unique → jamais
--      deux charges pour la même transaction) ;
--    - expenses.review_status : 'validated' (comptée), 'to_review' (À
--      vérifier, non comptée tant qu'elle n'est pas classée), 'excluded'
--      (perso / hors activité, non comptée) ;
--    - expenses.external_ref : clé des charges saisies par script (frais
--      Stripe d'un mois, facture OGATE) pour rester rejouable ;
--    - catégories de charges complétées / renommées ;
--    - accounting_import_bank_expenses() : importe les débits Qonto selon
--      des règles de libellé (idempotent), appelée ici puis depuis l'onglet
--      Charges ;
--    - accounting_classify_expense() : classement en un clic d'une charge
--      « À vérifier » (charge pro → catégorie, ou perso → exclue).
--    - seed : frais Stripe juillet → octobre 2026, frais d'approche OGATE
--      d'octobre 2026.
--
-- La synchro Qonto (qonto-sync) n'est pas modifiée : elle ne réécrit jamais
-- reconciliation_status / matched_* (upsert des seuls champs Qonto).
-- ============================================================================

-- ── A. Autres revenus ↔ transactions Qonto ──────────────────────────────────
alter table public.manual_revenues
  add column if not exists bank_transaction_id uuid references public.bank_transactions (id) on delete set null;

-- Rattachement : crédit Qonto du même jour (à 2 jours près) et du même montant,
-- pas encore rapproché, pas déjà pris par un autre revenu.
do $$
declare
  r record;
  v_tx uuid;
begin
  for r in select * from public.manual_revenues where bank_transaction_id is null order by revenue_date, amount loop
    select t.id into v_tx
    from public.bank_transactions t
    where t.side = 'credit'
      and t.amount = r.amount
      and coalesce(t.settled_at, t.emitted_at)::date between r.revenue_date - 2 and r.revenue_date + 2
      and t.matched_type is null
      and not exists (select 1 from public.manual_revenues m where m.bank_transaction_id = t.id)
    order by abs(coalesce(t.settled_at, t.emitted_at)::date - r.revenue_date)
    limit 1;
    if v_tx is not null then
      update public.manual_revenues set bank_transaction_id = v_tx where id = r.id;
      update public.bank_transactions
      set reconciliation_status = 'matched', matched_type = 'other', note = 'Autre revenu : ' || r.label || ' (' || r.client_name || ')'
      where id = v_tx;
    end if;
  end loop;
end $$;

-- ── B. Charges ──────────────────────────────────────────────────────────────
alter table public.expenses add column if not exists bank_transaction_id uuid references public.bank_transactions (id) on delete set null;
alter table public.expenses add column if not exists review_status text not null default 'validated';
alter table public.expenses add column if not exists external_ref text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'expenses_review_status_check') then
    alter table public.expenses add constraint expenses_review_status_check check (review_status in ('validated', 'to_review', 'excluded'));
  end if;
end $$;

create unique index if not exists expenses_bank_transaction_id_key on public.expenses (bank_transaction_id) where bank_transaction_id is not null;
create unique index if not exists expenses_external_ref_key on public.expenses (external_ref) where external_ref is not null;

-- Catégories : renommage des catégories de départ (0274, encore sans charge)
-- puis ajout des catégories manquantes.
update public.expense_categories set name = 'Locaux' where name = 'Loyer & locaux' and not exists (select 1 from public.expense_categories where name = 'Locaux');
update public.expense_categories set name = 'Marketing' where name = 'Marketing & publicité' and not exists (select 1 from public.expense_categories where name = 'Marketing');
update public.expense_categories set name = 'Logiciels & IA' where name = 'Logiciels & abonnements' and not exists (select 1 from public.expense_categories where name = 'Logiciels & IA');
update public.expense_categories set name = 'Autres' where name = 'Autre' and not exists (select 1 from public.expense_categories where name = 'Autres');
update public.expenses set category = 'Locaux' where category = 'Loyer & locaux';
update public.expenses set category = 'Marketing' where category = 'Marketing & publicité';
update public.expenses set category = 'Logiciels & IA' where category = 'Logiciels & abonnements';
update public.expenses set category = 'Autres' where category = 'Autre';

insert into public.expense_categories (name, position)
select v.name, v.position
from (values
  ('Frais Stripe', 10),
  ('Frais d''approche OGATE', 20),
  ('Locaux', 30),
  ('Authentification', 40),
  ('Logistique hors Sendcloud', 50),
  ('Frais bancaires', 60),
  ('Logiciels & IA', 70),
  ('Marketing', 80),
  ('Télécom', 90),
  ('Déplacements', 100),
  ('Frais d''envoi', 110),
  ('Commissions fournisseurs', 120),
  ('Frais de douane', 130),
  ('Emballages & fournitures', 140),
  ('Achat marchandise', 150),
  ('Autres', 200)
) as v (name, position)
on conflict (name) do update set position = excluded.position;

-- Qui peut importer / classer : le propriétaire (comme expenses), ou une
-- exécution serveur (migration, service role : auth.uid() null).
create or replace function public.accounting_is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is null
      or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin');
$$;

-- Import des débits Qonto en charges. Idempotent : une transaction déjà
-- reliée à une charge, déjà rapprochée ou déjà ignorée n'est jamais reprise.
create or replace function public.accounting_import_bank_expenses()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
$$;

-- Classement d'une charge : p_decision 'pro' (catégorie obligatoire, comptée)
-- ou 'perso' (exclue, transaction Qonto ignorée).
create or replace function public.accounting_classify_expense(p_expense_id uuid, p_decision text, p_category text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx uuid;
begin
  if not public.accounting_is_owner() then
    raise exception 'Accès refusé.';
  end if;
  if p_decision not in ('pro', 'perso') then
    raise exception 'Décision invalide.';
  end if;
  if p_decision = 'pro' and coalesce(trim(p_category), '') = '' then
    raise exception 'Choisissez une catégorie.';
  end if;

  update public.expenses
  set review_status = case when p_decision = 'pro' then 'validated' else 'excluded' end,
      category = case when p_decision = 'pro' then trim(p_category) else category end
  where id = p_expense_id
  returning bank_transaction_id into v_tx;
  if not found then
    raise exception 'Charge introuvable.';
  end if;

  if v_tx is not null then
    update public.bank_transactions
    set reconciliation_status = case when p_decision = 'pro' then 'matched' else 'ignored' end,
        matched_type = case when p_decision = 'pro' then 'expense' else matched_type end,
        matched_expense_id = p_expense_id,
        note = case when p_decision = 'perso' then 'Dépense perso / hors activité (exclue des charges)' else note end
    where id = v_tx;
  end if;
end;
$$;

revoke all on function public.accounting_is_owner() from public, anon;
revoke all on function public.accounting_import_bank_expenses() from public, anon;
revoke all on function public.accounting_classify_expense(uuid, text, text) from public, anon;
grant execute on function public.accounting_is_owner() to authenticated;
grant execute on function public.accounting_import_bank_expenses() to authenticated;
grant execute on function public.accounting_classify_expense(uuid, text, text) to authenticated;

-- Frais Stripe (déduits avant virement, invisibles sur Qonto) : un par mois.
insert into public.expenses (label, category, amount, spent_at, notes, external_ref, review_status)
values
  ('Frais Stripe – juillet 2026', 'Frais Stripe', 139.81, '2026-07-31', 'Frais de paiement + frais de virement', 'stripe-fees-2026-07', 'validated'),
  ('Frais Stripe – août 2026', 'Frais Stripe', 275.96, '2026-08-31', 'Frais de paiement + frais de virement', 'stripe-fees-2026-08', 'validated'),
  ('Frais Stripe – septembre 2026', 'Frais Stripe', 299.37, '2026-09-30', 'Frais de paiement + frais de virement', 'stripe-fees-2026-09', 'validated'),
  ('Frais Stripe – octobre 2026', 'Frais Stripe', 848.36, '2026-10-31', 'Frais de paiement + frais de virement', 'stripe-fees-2026-10', 'validated')
on conflict (external_ref) where external_ref is not null do nothing;

-- Frais d'approche OGATE d'octobre : 360 740 ¥ au taux JPY→EUR du jour de la
-- facture (jpy_eur_rates), ou au dernier taux connu avant cette date.
insert into public.expenses (label, category, amount, spent_at, notes, external_ref, review_status)
select
  'Expédition OGATE octobre (360 740 ¥)',
  'Frais d''approche OGATE',
  round(360740 * r.rate, 2),
  '2026-10-31',
  '(E) Shipping Fee 360 740 ¥ × ' || r.rate::text || ' (taux du ' || to_char(r.rate_date, 'DD/MM/YYYY') || ')',
  'ogate-shipping-2026-10',
  'validated'
from (
  select rate, rate_date from public.jpy_eur_rates where rate_date <= '2026-10-31' order by rate_date desc limit 1
) r
on conflict (external_ref) where external_ref is not null do nothing;

-- Premier import des débits Qonto.
select public.accounting_import_bank_expenses();

notify pgrst, 'reload schema';
