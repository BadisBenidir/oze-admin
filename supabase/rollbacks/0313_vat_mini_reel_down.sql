-- Annulation de 0313_vat_mini_reel.sql (et de 0314 si appliquée).
-- Remet le régime « franchise puis bascule », retire les colonnes ajoutées
-- (réglages de récupération / TVA import saisis depuis : perdus) et rétablit
-- les fonctions de 0280 / 0290.

update public.vat_settings set regime = 'assujetti' where id and regime = 'reel';

alter table public.vat_settings drop constraint if exists vat_settings_liability_required;
alter table public.vat_settings drop constraint if exists vat_settings_regime_check;
alter table public.vat_settings add constraint vat_settings_regime_check check (regime in ('franchise', 'assujetti'));
alter table public.vat_settings drop column if exists liability_start_at, drop column if exists advances_vat_on_receipt;

create or replace function public.vat_rate_at(p_at timestamptz)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((
    select case when s.regime = 'assujetti' and s.vat_start_at is not null and p_at >= s.vat_start_at then s.vat_rate else 0 end
    from public.vat_settings s where s.id
  ), 0);
$$;

drop function if exists public.vat_accounting_rate_at(timestamptz);

alter table public.expense_categories drop column if exists vat_recovery_rate, drop column if exists foreign_supplier;
alter table public.expenses drop column if exists vat_recovery_rate, drop column if exists foreign_supplier, drop column if exists import_vat_amount;
alter table public.vat_declarations drop column if exists foreign_services_autoliquidation;
alter table public.vat_invoice_rectifications drop column if exists hidden_at;

-- Puis réappliquer allocate_expense_to_products depuis 0290_expense_cost_allocations.sql
-- (définition d'origine, lignes « create or replace function public.allocate_expense_to_products »).

notify pgrst, 'reload schema';
