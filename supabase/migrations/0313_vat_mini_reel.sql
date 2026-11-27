-- ============================================================================
-- TVA : régime miniréel (réel normal TVA, CA3 mensuelle) depuis le début
-- d'activité (20/05/2026).
--
-- Deux dates distinctes dans vat_settings :
--   - liability_start_at (nouveau) : début d'assujettissement. Sert aux
--     CALCULS (CA HT, TVA collectée / déductible, résultat) : chaque montant
--     encaissé depuis cette date est TTC (HT = TTC / 1,2).
--   - vat_start_at (existant, 06/11/2026) : TVA FACTURÉE à partir de cette
--     date. Sert aux factures, aux rectificatives et aux ventes Instagram :
--     rien ne change de ce côté (aucune facture réémise, aucune rectificative
--     générée pour les ventes antérieures).
--
-- Régimes :
--   - 'franchise' : franchise en base (aucune TVA) ;
--   - 'assujetti' : franchise puis bascule à vat_start_at (ancien mode,
--     conservé et sélectionnable) ;
--   - 'reel'      : miniréel, assujetti depuis liability_start_at.
-- Ce fichier n'ACTIVE pas le régime 'reel' (voir 0314) : l'admin déjà en
-- ligne ne connaît pas encore ce régime.
--
-- Charges :
--   - expense_categories.vat_recovery_rate / foreign_supplier : taux de
--     récupération par défaut et fournisseur étranger (autoliquidation) ;
--   - expenses.vat_recovery_rate / foreign_supplier : réglage charge par
--     charge (null = défaut : mots-clés du libellé, puis catégorie) ;
--   - expenses.import_vat_amount : TVA import payée (ligne B00 du DAU).
-- Déclarations :
--   - vat_declarations.foreign_services_autoliquidation : services étrangers
--     autoliquidés saisis à la main (en plus de ceux calculés sur les charges).
--
-- Annulation : supabase/rollbacks/0313_vat_mini_reel_down.sql
-- ============================================================================

alter table public.vat_settings
  add column if not exists liability_start_at timestamptz,
  add column if not exists advances_vat_on_receipt boolean not null default false;

alter table public.vat_settings drop constraint if exists vat_settings_regime_check;
alter table public.vat_settings
  add constraint vat_settings_regime_check check (regime in ('franchise', 'assujetti', 'reel'));
alter table public.vat_settings drop constraint if exists vat_settings_liability_required;
alter table public.vat_settings
  add constraint vat_settings_liability_required check (regime <> 'reel' or (liability_start_at is not null and vat_start_at is not null));

-- 20/05/2026 00:00 heure de Paris (début d'activité, enregistrement SIE).
update public.vat_settings
set liability_start_at = timestamptz '2026-05-20 00:00:00 Europe/Paris'
where id and liability_start_at is null;

-- Taux FACTURÉ (factures, rectificatives, Instagram) : inchangé, le régime
-- miniréel facture la TVA à partir de vat_start_at comme l'ancien mode.
create or replace function public.vat_rate_at(p_at timestamptz)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case when s.regime in ('assujetti', 'reel') and s.vat_start_at is not null and p_at >= s.vat_start_at then s.vat_rate else 0 end
    from public.vat_settings s where s.id
  ), 0);
$$;

-- Taux COMPTABLE (calculs) : depuis le début d'assujettissement en miniréel.
create or replace function public.vat_accounting_rate_at(p_at timestamptz)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case
      when s.regime = 'reel' and s.liability_start_at is not null and p_at >= s.liability_start_at then s.vat_rate
      when s.regime = 'assujetti' and s.vat_start_at is not null and p_at >= s.vat_start_at then s.vat_rate
      else 0 end
    from public.vat_settings s where s.id
  ), 0);
$$;
grant execute on function public.vat_accounting_rate_at(timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Charges
-- ---------------------------------------------------------------------------
alter table public.expense_categories
  add column if not exists vat_recovery_rate numeric(5,2) not null default 100 check (vat_recovery_rate between 0 and 100),
  add column if not exists foreign_supplier boolean not null default false;

alter table public.expenses
  add column if not exists vat_recovery_rate numeric(5,2) check (vat_recovery_rate is null or vat_recovery_rate between 0 and 100),
  add column if not exists foreign_supplier boolean,
  add column if not exists import_vat_amount numeric(10,2) check (import_vat_amount is null or import_vat_amount >= 0);

-- Défauts par catégorie (modifiables dans Charges → Catégories). Les cas
-- particuliers (carburant 80 %, Uber / SNCF / restaurants 0 %, frais de
-- change 0 %, Anthropic / Supabase / Google / Meta étrangers) sont reconnus
-- au libellé côté admin (src/utils/vatRecovery.ts) tant que la charge n'a
-- pas son propre réglage.
update public.expense_categories set vat_recovery_rate = 0
where name in ('Frais Stripe', 'Frais d''approche OGATE', 'Authentification');
update public.expense_categories set foreign_supplier = true
where name = 'Authentification';

alter table public.vat_declarations
  add column if not exists foreign_services_autoliquidation numeric(12,2) not null default 0 check (foreign_services_autoliquidation >= 0);

-- Suggestions de factures rectificatives masquées (brouillons seulement).
alter table public.vat_invoice_rectifications
  add column if not exists hidden_at timestamptz;

-- Ventilation d'une charge sur des articles (0290) : la TVA déductible
-- (saisie × taux de récupération + TVA import B00) suit désormais la date
-- d'assujettissement, plus la date de facturation.
create or replace function public.allocate_expense_to_products(p_expense_id uuid, p_product_ids uuid[], p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expense public.expenses;
  v_base numeric;
  v_total_cost numeric;
  v_count int;
  v_rows jsonb := '[]'::jsonb;
  v_sum numeric := 0;
  v_share numeric;
  v_i int := 0;
  v_rate numeric;
  r record;
begin
  if not public.is_admin() then
    raise exception 'Accès refusé : réservé aux administrateurs';
  end if;
  select * into v_expense from public.expenses where id = p_expense_id;
  if not found then
    raise exception 'Charge introuvable';
  end if;
  if exists (select 1 from public.expense_cost_allocations where expense_id = p_expense_id) then
    raise exception 'Cette charge est déjà répartie sur des articles (annule d''abord la répartition)';
  end if;

  -- Part à répartir : montant hors TVA déductible (avant l'assujettissement :
  -- rien n'est déductible, tout reste dans le coût).
  select coalesce(v_expense.vat_recovery_rate, c.vat_recovery_rate, 100) into v_rate
  from (select 1) x left join public.expense_categories c on c.name = v_expense.category;
  v_base := round(v_expense.amount - case when public.vat_accounting_rate_at((v_expense.spent_at::text || ' 12:00')::timestamptz) > 0
                                          then coalesce(v_expense.vat_amount, 0) * coalesce(v_rate, 100) / 100 + coalesce(v_expense.import_vat_amount, 0)
                                          else 0 end, 2);
  if v_base <= 0 then
    raise exception 'Rien à répartir (montant hors TVA nul)';
  end if;

  select count(*), coalesce(sum(greatest(coalesce(purchase_price, 0), 0)), 0) into v_count, v_total_cost
  from public.products where id = any(p_product_ids);
  if v_count = 0 then
    raise exception 'Aucun article';
  end if;

  for r in
    select id, coalesce(product_code, reference, name) as code, name, purchase_price
    from public.products where id = any(p_product_ids)
    order by coalesce(purchase_price, 0), product_code
  loop
    v_i := v_i + 1;
    if v_i = v_count then
      v_share := v_base - v_sum;           -- dernier article : ajusté pour tomber juste
    elsif v_total_cost > 0 then
      v_share := round(v_base * greatest(coalesce(r.purchase_price, 0), 0) / v_total_cost, 2);
    else
      v_share := round(v_base / v_count, 2);  -- aucun prix d'achat : parts égales
    end if;
    v_sum := v_sum + v_share;
    v_rows := v_rows || jsonb_build_object(
      'product_id', r.id, 'code', r.code, 'name', r.name,
      'before', r.purchase_price, 'share', v_share, 'after', coalesce(r.purchase_price, 0) + v_share
    );
    if not p_dry_run then
      insert into public.expense_cost_allocations (expense_id, product_id, amount, purchase_price_before, expense_category_before)
      values (p_expense_id, r.id, v_share, r.purchase_price, v_expense.category);
      update public.products set purchase_price = coalesce(purchase_price, 0) + v_share where id = r.id;
    end if;
  end loop;

  if not p_dry_run then
    update public.expenses set category = 'Achat marchandise' where id = p_expense_id;
  end if;

  return jsonb_build_object('base', v_base, 'count', v_count, 'total_cost_before', v_total_cost, 'dry_run', p_dry_run, 'rows', v_rows);
end;
$$;

notify pgrst, 'reload schema';
