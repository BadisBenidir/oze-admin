-- TVA : sortie de la franchise en base (art. 293 B du CGI).
--
-- Seuil majoré de 93 500 € de CA (ventes de marchandises) dépassé le
-- 06/11/2026 par le lot d'enchères AUC-20261106191100-7a16 (204,99 €, lot
-- clôturé à 20:11:00 heure de Paris ; cumul 93 336,42 € → 93 541,41 €, même
-- calcul que la page Comptabilité). La TVA est due dès cette opération,
-- incluse. Hypothèse sans prorata (année de création) : si le SIE retient le
-- prorata, la date devient le 14/10/2026 — tout se recalcule depuis
-- vat_settings.vat_start_at (écran Comptabilité → TVA).
--
-- Les prix de vente restent inchangés et deviennent TTC à partir de
-- vat_start_at : HT = TTC / (1 + taux), TVA = TTC − HT.
--
-- Contenu :
--   - vat_settings (ligne unique) + vat_rate_at(ts) : taux applicable à une
--     opération (0 avant la bascule) ;
--   - bank_transactions.vat_amount : TVA lue par Qonto (raw.vat_amount),
--     colonne calculée — la synchro Qonto n'est pas modifiée ;
--   - expenses.vat_amount : TVA déductible saisie à la main (prioritaire sur
--     celle de Qonto) ;
--   - vat_declarations : statut mensuel (à déclarer / déclarée / payée) et
--     TVA import autoliquidée (collectée = déduite, impact net nul).

create table if not exists public.vat_settings (
  id boolean primary key default true check (id),
  regime text not null default 'franchise' check (regime in ('franchise', 'assujetti')),
  vat_start_at timestamptz,
  vat_rate numeric(5,2) not null default 20 check (vat_rate >= 0 and vat_rate < 100),
  vat_number text,
  note text,
  updated_at timestamptz not null default now(),
  constraint vat_settings_start_required check (regime = 'franchise' or vat_start_at is not null)
);

insert into public.vat_settings (id, regime, vat_start_at, vat_rate, vat_number, note)
values (true, 'assujetti', timestamptz '2026-11-06 19:11:00.247651+00', 20, null,
        'Hypothèse sans prorata – à confirmer SIE (sinon 14/10/2026). Bascule : lot d''enchères AUC-20261106191100-7a16 (204,99 €), 06/11/2026 20:11 (Paris), cumul 93 336,42 € → 93 541,41 €.')
on conflict (id) do nothing;

alter table public.vat_settings enable row level security;
-- Lecture : toute personne connectée (taux, date, n° de TVA intracom de la
-- société : informations publiques, utiles aux factures côté revendeur).
drop policy if exists vat_settings_read on public.vat_settings;
create policy vat_settings_read on public.vat_settings for select to authenticated using (true);
drop policy if exists vat_settings_owner_write on public.vat_settings;
create policy vat_settings_owner_write on public.vat_settings
  for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

create or replace function public.vat_settings_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists vat_settings_touch on public.vat_settings;
create trigger vat_settings_touch before update on public.vat_settings for each row execute function public.vat_settings_touch();

-- Taux de TVA (en %) applicable à une opération datée de p_at : 0 en
-- franchise ou avant la bascule.
create or replace function public.vat_rate_at(p_at timestamptz)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case when s.regime = 'assujetti' and s.vat_start_at is not null and p_at >= s.vat_start_at then s.vat_rate else 0 end
    from public.vat_settings s where s.id
  ), 0);
$$;
grant execute on function public.vat_rate_at(timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- TVA déductible
-- ---------------------------------------------------------------------------
alter table public.bank_transactions
  add column if not exists vat_amount numeric(12,2)
  generated always as (nullif(raw->>'vat_amount', '')::numeric(12,2)) stored;

alter table public.expenses
  add column if not exists vat_amount numeric(10,2) check (vat_amount is null or vat_amount >= 0);

-- ---------------------------------------------------------------------------
-- Déclarations mensuelles
-- ---------------------------------------------------------------------------
create table if not exists public.vat_declarations (
  period date primary key check (extract(day from period) = 1),
  status text not null default 'a_declarer' check (status in ('a_declarer', 'declaree', 'payee')),
  import_autoliquidation numeric(12,2) not null default 0 check (import_autoliquidation >= 0),
  declared_at date,
  paid_at date,
  paid_amount numeric(12,2),
  notes text,
  updated_at timestamptz not null default now()
);

alter table public.vat_declarations enable row level security;
drop policy if exists vat_declarations_owner_all on public.vat_declarations;
create policy vat_declarations_owner_all on public.vat_declarations
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

drop trigger if exists vat_declarations_touch on public.vat_declarations;
create trigger vat_declarations_touch before update on public.vat_declarations for each row execute function public.vat_settings_touch();

notify pgrst, 'reload schema';
