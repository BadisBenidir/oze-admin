-- TVA sur les factures et avoirs (suite de 0280).
--
-- 1. invoices.vat_rate / credit_notes.vat_rate : taux figé à la création,
--    d'après la date de l'OPÉRATION (vat_rate_at) :
--      - facture de commande (B2B, B2C, lot d'enchères) : date de la commande ;
--      - facture d'avance de sourcing : date d'émission (encaissement) ;
--      - avoir : taux de la facture d'origine (sinon date de la commande).
--    NULL = document émis avant cette migration, sous la franchise
--    (« TVA non applicable, art. 293 B du CGI ») : il n'est jamais modifié.
--    Le rendu PDF (generateInvoicePdf.ts) et l'émission Qonto
--    (emit-qonto-invoice) lisent ce taux : > 0 → HT, TVA, TTC et n° de TVA,
--    sans la mention 293 B.
--
-- 2. vat_invoice_rectifications : factures (et avoirs) déjà émis SANS TVA
--    alors que l'opération est postérieure à la bascule. Pour chacun, une
--    facture rectificative en BROUILLON (même TTC, détail HT / TVA,
--    référence au document d'origine). Rien n'est envoyé au client :
--    l'émission (numéro dans la séquence FAC- / AV-) se fait à la main,
--    une par une, depuis Comptabilité → TVA → Factures à rectifier.
--    vat_refresh_rectifications() recalcule la liste depuis vat_settings
--    (à relancer si la date de bascule change).

alter table public.invoices add column if not exists vat_rate numeric(5,2);
alter table public.credit_notes add column if not exists vat_rate numeric(5,2);

create or replace function public.invoices_stamp_vat_rate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_at timestamptz;
begin
  if new.vat_rate is null then
    if new.kind = 'order' and new.order_id is not null then
      select created_at into v_at from public.orders where id = new.order_id;
    end if;
    new.vat_rate := public.vat_rate_at(coalesce(v_at, new.issued_at, now()));
  end if;
  return new;
end;
$$;

drop trigger if exists invoices_stamp_vat_rate on public.invoices;
create trigger invoices_stamp_vat_rate before insert on public.invoices
  for each row execute function public.invoices_stamp_vat_rate();

create or replace function public.credit_notes_stamp_vat_rate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_at timestamptz;
begin
  if new.vat_rate is null then
    select vat_rate into new.vat_rate from public.invoices where id = new.invoice_id;
    if new.vat_rate is null then
      select created_at into v_at from public.orders where id = new.order_id;
      new.vat_rate := public.vat_rate_at(coalesce(v_at, new.issued_at, now()));
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists credit_notes_stamp_vat_rate on public.credit_notes;
create trigger credit_notes_stamp_vat_rate before insert on public.credit_notes
  for each row execute function public.credit_notes_stamp_vat_rate();

-- ---------------------------------------------------------------------------
-- Factures à rectifier
-- ---------------------------------------------------------------------------
create table if not exists public.vat_invoice_rectifications (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid references public.invoices (id) on delete cascade,
  credit_note_id uuid references public.credit_notes (id) on delete cascade,
  original_number text not null,
  original_issued_at timestamptz not null,
  operation_at timestamptz not null,
  amount_ttc numeric(10,2) not null,
  vat_rate numeric(5,2) not null,
  amount_ht numeric(10,2) not null,
  vat_amount numeric(10,2) not null,
  status text not null default 'draft' check (status in ('draft', 'issued')),
  rectification_number text unique,
  issued_at timestamptz,
  created_at timestamptz not null default now(),
  constraint vat_invoice_rectifications_one_source check ((invoice_id is null) <> (credit_note_id is null))
);

create unique index if not exists vat_invoice_rectifications_invoice_key on public.vat_invoice_rectifications (invoice_id) where invoice_id is not null;
create unique index if not exists vat_invoice_rectifications_credit_note_key on public.vat_invoice_rectifications (credit_note_id) where credit_note_id is not null;

alter table public.vat_invoice_rectifications enable row level security;
drop policy if exists vat_invoice_rectifications_owner_read on public.vat_invoice_rectifications;
create policy vat_invoice_rectifications_owner_read on public.vat_invoice_rectifications
  for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

create or replace function public.vat_is_owner_or_server()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is null
      or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin');
$$;

-- Recalcule la liste des brouillons depuis vat_settings. Une rectificative
-- déjà émise n'est jamais touchée. Renvoie le nombre de brouillons.
create or replace function public.vat_refresh_rectifications()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  if not public.vat_is_owner_or_server() then
    raise exception 'Réservé au propriétaire';
  end if;

  drop table if exists _vat_candidates;
  create temp table _vat_candidates on commit drop as
  select i.id as invoice_id, null::uuid as credit_note_id, i.invoice_number as original_number, i.issued_at as original_issued_at,
         case when i.kind = 'order' then o.created_at else i.issued_at end as operation_at,
         i.total_amount as amount_ttc
  from public.invoices i
  left join public.orders o on o.id = i.order_id
  where i.vat_rate is null
    and i.merged_into_invoice_id is null
    and public.vat_rate_at(case when i.kind = 'order' then o.created_at else i.issued_at end) > 0
  union all
  select null, c.id, c.credit_note_number, c.issued_at, o.created_at, c.amount
  from public.credit_notes c
  join public.orders o on o.id = c.order_id
  where c.vat_rate is null
    and public.vat_rate_at(o.created_at) > 0;

  -- Brouillons devenus sans objet (date de bascule déplacée).
  delete from public.vat_invoice_rectifications r
  where r.status = 'draft'
    and not exists (
      select 1 from _vat_candidates c
      where c.invoice_id is not distinct from r.invoice_id and c.credit_note_id is not distinct from r.credit_note_id
    );

  -- Brouillons existants : montants recalculés au taux actuel.
  update public.vat_invoice_rectifications r
  set vat_rate = public.vat_rate_at(c.operation_at),
      amount_ttc = c.amount_ttc,
      amount_ht = round(c.amount_ttc / (1 + public.vat_rate_at(c.operation_at) / 100), 2),
      vat_amount = c.amount_ttc - round(c.amount_ttc / (1 + public.vat_rate_at(c.operation_at) / 100), 2),
      operation_at = c.operation_at
  from _vat_candidates c
  where r.status = 'draft'
    and c.invoice_id is not distinct from r.invoice_id and c.credit_note_id is not distinct from r.credit_note_id;

  insert into public.vat_invoice_rectifications
    (invoice_id, credit_note_id, original_number, original_issued_at, operation_at, amount_ttc, vat_rate, amount_ht, vat_amount)
  select c.invoice_id, c.credit_note_id, c.original_number, c.original_issued_at, c.operation_at, c.amount_ttc,
         public.vat_rate_at(c.operation_at),
         round(c.amount_ttc / (1 + public.vat_rate_at(c.operation_at) / 100), 2),
         c.amount_ttc - round(c.amount_ttc / (1 + public.vat_rate_at(c.operation_at) / 100), 2)
  from _vat_candidates c
  where not exists (
    select 1 from public.vat_invoice_rectifications r
    where c.invoice_id is not distinct from r.invoice_id and c.credit_note_id is not distinct from r.credit_note_id
  );

  select count(*) into v_count from public.vat_invoice_rectifications where status = 'draft';
  return v_count;
end;
$$;

-- Émet UNE rectificative : numéro dans la séquence des factures (FAC-) ou
-- des avoirs (AV-), sans rupture. N'envoie rien au client.
create or replace function public.vat_issue_rectification(p_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.vat_invoice_rectifications;
  v_year int := extract(year from now())::int;
  v_next int;
  v_number text;
begin
  if not public.vat_is_owner_or_server() then
    raise exception 'Réservé au propriétaire';
  end if;
  select * into v_row from public.vat_invoice_rectifications where id = p_id for update;
  if not found then
    raise exception 'Rectificative introuvable';
  end if;
  if v_row.status = 'issued' then
    return v_row.rectification_number;
  end if;

  if v_row.invoice_id is not null then
    insert into public.invoice_counters (year, last_number) values (v_year, 0) on conflict (year) do nothing;
    update public.invoice_counters set last_number = last_number + 1 where year = v_year returning last_number into v_next;
    v_number := 'FAC-' || v_year || '-' || lpad(v_next::text, 5, '0');
  else
    insert into public.credit_note_counters (year, last_number) values (v_year, 0) on conflict (year) do nothing;
    update public.credit_note_counters set last_number = last_number + 1 where year = v_year returning last_number into v_next;
    v_number := 'AV-' || v_year || '-' || lpad(v_next::text, 5, '0');
  end if;

  update public.vat_invoice_rectifications
  set status = 'issued', rectification_number = v_number, issued_at = now()
  where id = p_id;
  return v_number;
end;
$$;

revoke all on function public.vat_refresh_rectifications() from public, anon;
revoke all on function public.vat_issue_rectification(uuid) from public, anon;
grant execute on function public.vat_refresh_rectifications() to authenticated;
grant execute on function public.vat_issue_rectification(uuid) to authenticated;

select public.vat_refresh_rectifications();

notify pgrst, 'reload schema';
