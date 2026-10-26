-- ============================================================================
-- Avoirs (factures de remboursement).
--
-- Un article annulé et remboursé (portefeuille ou carte) alors que la facture
-- de sa commande était DÉJÀ émise doit faire l'objet d'un avoir : la facture
-- émise est figée et facture encore l'article. Si la facture a été émise
-- après l'annulation, elle ne facture déjà plus l'article — pas d'avoir.
--   - credit_notes : un avoir par article remboursé, numérotation séquentielle
--     sans rupture par année (AV-AAAA-NNNNN), rattaché à la facture d'origine
--     (la facture commune du groupe si elle est partagée, 0227) ;
--   - create_credit_note_for_item : création idempotente ;
--   - trigger : avoir créé dès que le remboursement d'un article réussit ;
--   - rattrapage des remboursements déjà faits.
-- Le PDF est régénéré à la demande (generateInvoicePdf.ts), comme les factures.
-- ============================================================================

create table if not exists public.credit_notes (
  id uuid primary key default gen_random_uuid(),
  credit_note_number text not null unique,
  invoice_id uuid not null references public.invoices (id),
  order_id uuid not null references public.orders (id) on delete cascade,
  order_item_id uuid not null unique references public.order_items (id) on delete cascade,
  profile_id uuid not null references public.profiles (id),
  issued_at timestamptz not null default now(),
  amount numeric(10, 2) not null,
  refund_method text,
  reason text,
  legal_status text not null,
  billing_details jsonb not null,
  lines jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists credit_notes_order_idx on public.credit_notes (order_id);
create index if not exists credit_notes_profile_idx on public.credit_notes (profile_id);

alter table public.credit_notes enable row level security;

drop policy if exists credit_notes_admin_all on public.credit_notes;
create policy credit_notes_admin_all on public.credit_notes
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists credit_notes_owner_select on public.credit_notes;
create policy credit_notes_owner_select on public.credit_notes
  for select using (profile_id = auth.uid());

revoke all on public.credit_notes from public, authenticated;
grant select on public.credit_notes to authenticated;

create table if not exists public.credit_note_counters (
  year int primary key,
  last_number int not null default 0
);
alter table public.credit_note_counters enable row level security;
drop policy if exists credit_note_counters_admin_all on public.credit_note_counters;
create policy credit_note_counters_admin_all on public.credit_note_counters
  for all using (public.is_admin()) with check (public.is_admin());
revoke all on public.credit_note_counters from public, authenticated;

create or replace function public.create_credit_note_for_item(p_item_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item record;
  v_order record;
  v_invoice record;
  v_existing uuid;
  v_name text;
  v_insurance numeric;
  v_lines jsonb;
  v_amount numeric;
  v_year int;
  v_next int;
  v_id uuid;
begin
  select id into v_existing from public.credit_notes where order_item_id = p_item_id;
  if v_existing is not null then
    return v_existing;
  end if;

  select * into v_item from public.order_items where id = p_item_id;
  if not found or v_item.status <> 'cancelled' or v_item.refund_status is distinct from 'succeeded' or v_item.cancelled_at is null then
    return null;
  end if;

  select * into v_order from public.orders where id = v_item.order_id;
  if not found or v_order.payment_status <> 'paid' then
    return null;
  end if;

  -- Facture de la commande émise AVANT l'annulation (sinon elle ne facture
  -- déjà plus l'article) ; facture commune du groupe si partagée (0227).
  select coalesce(m.id, i.id) as id, coalesce(m.legal_status, i.legal_status) as legal_status,
         coalesce(m.billing_details, i.billing_details) as billing_details
  into v_invoice
  from public.invoices i
  left join public.invoices m on m.id = i.merged_into_invoice_id
  where i.order_id = v_order.id and i.kind = 'order' and i.issued_at < v_item.cancelled_at
  limit 1;
  if v_invoice.id is null then
    return null;
  end if;

  v_name := coalesce(v_item.product_snapshot ->> 'name', 'Article');
  v_insurance := case when v_item.insured then coalesce(v_item.insurance_cost, 0) else 0 end;
  v_lines := jsonb_build_array(jsonb_build_object(
    'description', v_name, 'unitPrice', v_item.unit_price, 'quantity', v_item.quantity, 'lineTotal', v_item.line_total
  ));
  if v_insurance > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'description', 'Assurance transport — ' || v_name, 'unitPrice', v_insurance, 'quantity', 1, 'lineTotal', v_insurance
    ));
  end if;
  v_amount := coalesce(v_item.line_total, 0) + v_insurance;
  if v_amount <= 0 then
    return null;
  end if;

  -- Numérotation séquentielle sans rupture, par année de l'avoir.
  v_year := extract(year from now())::int;
  insert into public.credit_note_counters (year, last_number) values (v_year, 0) on conflict (year) do nothing;
  update public.credit_note_counters set last_number = last_number + 1 where year = v_year returning last_number into v_next;

  insert into public.credit_notes (
    credit_note_number, invoice_id, order_id, order_item_id, profile_id, amount, refund_method, reason,
    legal_status, billing_details, lines
  )
  values (
    'AV-' || v_year || '-' || lpad(v_next::text, 5, '0'), v_invoice.id, v_order.id, v_item.id,
    coalesce(v_order.placed_by_profile_id, v_order.user_id), v_amount, v_item.refund_method, v_item.cancellation_reason,
    v_invoice.legal_status, v_invoice.billing_details, v_lines
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.create_credit_note_for_item(uuid) from public, anon, authenticated;

-- Dès que le remboursement d'un article réussit : avoir (sans jamais bloquer
-- le remboursement en cas d'erreur).
create or replace function public.order_items_create_credit_note()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'cancelled' and new.refund_status = 'succeeded'
     and (tg_op = 'INSERT' or old.refund_status is distinct from 'succeeded' or old.status is distinct from 'cancelled') then
    begin
      perform public.create_credit_note_for_item(new.id);
    exception when others then
      raise warning 'Avoir non créé pour l''article % : %', new.id, sqlerrm;
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists order_items_create_credit_note on public.order_items;
create trigger order_items_create_credit_note
  after update of refund_status, status on public.order_items
  for each row execute function public.order_items_create_credit_note();

-- Rattrapage : remboursements déjà faits, dans l'ordre chronologique.
do $$
declare
  r record;
begin
  for r in
    select id from public.order_items
    where status = 'cancelled' and refund_status = 'succeeded'
    order by cancelled_at
  loop
    perform public.create_credit_note_for_item(r.id);
  end loop;
end;
$$;

notify pgrst, 'reload schema';
