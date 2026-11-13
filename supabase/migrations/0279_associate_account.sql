-- Comptabilité : compte courant d'associé (dette de la SAS envers le
-- président, associé unique).
--
-- Sens : 'apport' et 'depense_payee_perso' augmentent la dette de la société
-- envers l'associé ; 'retrait' et 'remboursement_associe' la diminuent. Les
-- montants sont toujours positifs : le sens vient du type.
--
-- Ces mouvements ne sont ni du CA ni des charges : seule la dépense payée en
-- perso est une charge (expenses, onglet Charges), reliée par expense_id.
--
-- Réservé au propriétaire (comme expenses, 0274) : profiles.role = 'admin'.
-- Justificatifs : bucket privé accounting-receipts.
--
-- Seed : apports et retraits retrouvés sur Qonto (reliés par
-- bank_transaction_id) + facture Fnac du PC (699,99 € TTC : 200 € débités
-- sur Qonto le 03/09, 499,99 € payés avec la carte perso). Les petits
-- crédits de 5 à 30 € (juin-juillet) et le crédit de 243 € du 07/08 ne sont
-- pas repris : à confirmer.

create table if not exists public.associate_account_entries (
  id uuid primary key default gen_random_uuid(),
  entry_date date not null,
  type text not null check (type in ('apport', 'depense_payee_perso', 'retrait', 'remboursement_associe')),
  label text not null,
  amount numeric(10,2) not null check (amount > 0),
  expense_id uuid references public.expenses (id) on delete set null,
  bank_transaction_id uuid references public.bank_transactions (id) on delete set null,
  receipt_path text,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists associate_account_entries_entry_date_idx on public.associate_account_entries (entry_date);
create unique index if not exists associate_account_entries_bank_transaction_id_key
  on public.associate_account_entries (bank_transaction_id) where bank_transaction_id is not null;

alter table public.associate_account_entries enable row level security;
drop policy if exists associate_account_entries_owner_all on public.associate_account_entries;
create policy associate_account_entries_owner_all on public.associate_account_entries
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- ---------------------------------------------------------------------------
-- Justificatifs
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('accounting-receipts', 'accounting-receipts', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
on conflict (id) do update
set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists accounting_receipts_owner_all on storage.objects;
create policy accounting_receipts_owner_all on storage.objects
  for all to authenticated
  using (bucket_id = 'accounting-receipts' and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (bucket_id = 'accounting-receipts' and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- ---------------------------------------------------------------------------
-- Dépense payée en perso : crée la charge (comptée, onglet Charges) et la
-- ligne de dette d'un même geste.
-- ---------------------------------------------------------------------------
create or replace function public.associate_add_personal_expense(
  p_date date,
  p_label text,
  p_amount numeric,
  p_category text,
  p_notes text default null,
  p_receipt_path text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expense uuid;
  v_entry uuid;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin') then
    raise exception 'Réservé au propriétaire';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Montant invalide';
  end if;
  if coalesce(trim(p_label), '') = '' then
    raise exception 'Libellé obligatoire';
  end if;

  insert into public.expenses (label, category, amount, spent_at, notes, review_status)
  values (trim(p_label), nullif(trim(coalesce(p_category, '')), ''), p_amount, p_date,
          coalesce(nullif(trim(coalesce(p_notes, '')), '') || ' – ', '') || 'Payé en perso (compte courant d''associé)', 'validated')
  returning id into v_expense;

  insert into public.associate_account_entries (entry_date, type, label, amount, expense_id, receipt_path, notes)
  values (p_date, 'depense_payee_perso', trim(p_label), p_amount, v_expense, p_receipt_path, nullif(trim(coalesce(p_notes, '')), ''))
  returning id into v_entry;

  return v_entry;
end;
$$;

revoke all on function public.associate_add_personal_expense(date, text, numeric, text, text, text) from public, anon;
grant execute on function public.associate_add_personal_expense(date, text, numeric, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Seed 1 : facture Fnac (PC portable Lenovo, facture 2624480112).
-- La charge « FNAC » importée de Qonto (200 €, 03/09) devient la charge
-- complète de 699,99 € ; la part payée en perso (499,99 €) entre en dette.
-- ---------------------------------------------------------------------------
update public.expenses
set amount = 699.99,
    label = 'Fnac – PC portable Lenovo (facture 2624480112)',
    category = 'Autres',
    spent_at = date '2026-09-01',
    notes = 'PC pro – 200 € Qonto + 499,99 € payé en perso'
where id = '32081c7e-47aa-46c7-aaeb-f4be9792586a'
  and amount = 200;

insert into public.associate_account_entries (entry_date, type, label, amount, expense_id, notes)
select date '2026-09-01', 'depense_payee_perso', 'Fnac – PC portable Lenovo (facture 2624480112)', 499.99,
       '32081c7e-47aa-46c7-aaeb-f4be9792586a', 'Facture 699,99 € TTC : 200 € payés depuis Qonto le 03/09, 499,99 € avec la carte perso'
where exists (select 1 from public.expenses where id = '32081c7e-47aa-46c7-aaeb-f4be9792586a')
  and not exists (select 1 from public.associate_account_entries where expense_id = '32081c7e-47aa-46c7-aaeb-f4be9792586a');

-- ---------------------------------------------------------------------------
-- Seed 2 : mouvements Qonto (le capital social de 1 000 € versé par le
-- notaire le 28/05 n'est pas un apport en compte courant : exclu).
-- ---------------------------------------------------------------------------
with moves (bank_transaction_id, type, label) as (
  values
    -- Apports
    ('3023f82a-0472-4e28-a1bc-3f7d85772df8'::uuid, 'apport', 'Apport en compte courant (EI Ligne Blanche)'),
    ('4690e3ac-609b-4915-9ece-323441d6f316'::uuid, 'apport', 'Apport en compte courant (EI Ligne Blanche)'),
    ('9e41952f-4023-4291-9828-a3d66d8d2dca'::uuid, 'apport', 'Apport en compte courant'),
    ('e0718080-68ac-4778-92af-664243d30721'::uuid, 'apport', 'Apport en compte courant'),
    -- Retraits
    ('3a9b07e6-7e3d-4a59-a6b5-a2736762bc03'::uuid, 'retrait', 'Retrait associé'),
    ('332aa1ff-cf6c-4639-a60f-ae776737d3c0'::uuid, 'retrait', 'Retrait associé'),
    ('d8e73342-d62c-47a4-afaa-9c8229177999'::uuid, 'remboursement_associe', 'Remboursement compte courant d''associé'),
    ('6eafe163-7634-4b34-9471-ce89ac7b55ce'::uuid, 'retrait', 'Retrait associé'),
    ('f7d1e7f6-04ac-4f7f-ba15-fc18a4e0c201'::uuid, 'retrait', 'Retrait associé'),
    ('7ba03d46-991a-484c-a27b-b77875dc6f41'::uuid, 'retrait', 'Retrait associé'),
    ('384f3f6b-9304-4f34-9dd1-8c199a435e1a'::uuid, 'retrait', 'Retrait associé'),
    ('ffe9c427-c48e-40e7-8e3a-9e337299e5e4'::uuid, 'retrait', 'Retrait associé'),
    ('029ecdf9-2a87-4673-a111-c7b56cfb6f96'::uuid, 'retrait', 'Retrait associé'),
    ('ccebf3d6-a8a9-4d11-997e-ded650c4cce6'::uuid, 'retrait', 'Retrait associé'),
    ('e4b3d12f-2bb8-4c4a-afe4-b0a9982620db'::uuid, 'retrait', 'Retrait associé'),
    ('e64571d2-2555-4b23-993e-a3215798b552'::uuid, 'retrait', 'Retrait associé'),
    ('e69898c8-03e5-40c6-be0f-99595af86d80'::uuid, 'retrait', 'Retrait associé'),
    ('fb0237dd-d9ce-44da-8e60-cc6f4762fc56'::uuid, 'retrait', 'Retrait associé'),
    ('4a274ede-a284-4900-a738-3213c60732d7'::uuid, 'retrait', 'Retrait associé'),
    ('1d89c6be-ade4-4719-8bbe-5af436b2538c'::uuid, 'retrait', 'Retrait associé')
),
ins as (
  insert into public.associate_account_entries (entry_date, type, label, amount, bank_transaction_id, notes)
  select (b.settled_at at time zone 'Europe/Paris')::date, m.type, m.label, b.amount, b.id, 'Qonto : ' || b.label
  from moves m
  join public.bank_transactions b on b.id = m.bank_transaction_id
  where b.side = case when m.type = 'apport' then 'credit' else 'debit' end
    and not exists (select 1 from public.associate_account_entries a where a.bank_transaction_id = b.id)
  returning bank_transaction_id, type
)
update public.bank_transactions b
set reconciliation_status = 'matched',
    matched_type = 'other',
    note = case ins.type
      when 'apport' then 'Compte courant d''associé : apport'
      when 'remboursement_associe' then 'Compte courant d''associé : remboursement à l''associé'
      else 'Compte courant d''associé : retrait'
    end
from ins
where b.id = ins.bank_transaction_id;

notify pgrst, 'reload schema';
