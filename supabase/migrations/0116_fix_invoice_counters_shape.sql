-- ============================================================================
-- Corrige invoice_counters : une table de ce nom existait déjà sur la base
-- distante avec une structure différente (sans colonne `year`), probablement
-- un reliquat d'un essai antérieur à la version finale de 0115_invoices.sql
-- — jamais une migration ne pouvait l'anticiper (0115 n'utilisait que
-- `create table if not exists`, qui ne modifie jamais un table existante).
--
-- Chaque appel de generate_invoice_for_order échouait donc sur
-- `update public.invoice_counters set last_number = ... where year = ...`
-- avant même d'insérer quoi que ce soit dans invoices (la transaction PL/pgSQL
-- est annulée par l'exception) : aucune facture n'a pu être créée, cette
-- table peut donc être recréée sans perte de données.
-- ============================================================================

drop table if exists public.invoice_counters cascade;

create table public.invoice_counters (
  year int primary key,
  last_number int not null default 0
);
alter table public.invoice_counters enable row level security;
drop policy if exists invoice_counters_admin_all on public.invoice_counters;
create policy invoice_counters_admin_all on public.invoice_counters
  for all using (public.is_admin()) with check (public.is_admin());
revoke all on public.invoice_counters from public, authenticated;

notify pgrst, 'reload schema';
