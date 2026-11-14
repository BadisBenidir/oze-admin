-- Frais d'approche (paiements DHL : droits de douane, taxes, frais DHL)
-- répartis sur le coût d'achat des articles de l'envoi.
--
-- Depuis l'onglet Charges : sur un paiement DHL, l'admin saisit la TVA
-- d'import déductible (vat_amount, après la bascule TVA) puis colle les
-- références des articles de l'envoi. La part hors TVA (montant − TVA
-- déductible ; tout le montant avant la bascule : TVA d'import non
-- déductible, elle fait partie du coût) est répartie au prorata du prix
-- d'achat des articles (dernier article ajusté pour tomber juste) et ajoutée
-- à products.purchase_price. La charge passe en « Achat marchandise » : elle
-- est désormais dans le coût des articles, plus en charge externe (pas de
-- double comptage). Les commandes déjà passées gardent leur coût figé
-- (order_items.product_snapshot) : volontairement non modifiées.
--
--   - expense_cost_allocations : trace de chaque répartition (montant par
--     article, prix d'achat avant, catégorie d'origine de la charge) ;
--   - allocate_expense_to_products(expense, produits, dry_run) : aperçu
--     (dry_run) ou application, une seule répartition par charge ;
--   - cancel_expense_allocation(expense) : annule (prix d'achat et
--     catégorie restaurés).

create table if not exists public.expense_cost_allocations (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  amount numeric(10, 2) not null,
  purchase_price_before numeric(10, 2),
  expense_category_before text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index if not exists expense_cost_allocations_expense_idx on public.expense_cost_allocations (expense_id);
create index if not exists expense_cost_allocations_product_idx on public.expense_cost_allocations (product_id);

alter table public.expense_cost_allocations enable row level security;
drop policy if exists expense_cost_allocations_admin_read on public.expense_cost_allocations;
create policy expense_cost_allocations_admin_read on public.expense_cost_allocations
  for select to authenticated using (public.is_admin());

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

  -- Part à répartir : montant hors TVA déductible (TVA d'import avant la
  -- bascule : non déductible, elle reste dans le coût).
  v_base := round(v_expense.amount - case when public.vat_rate_at((v_expense.spent_at::text || ' 12:00')::timestamptz) > 0
                                          then coalesce(v_expense.vat_amount, 0) else 0 end, 2);
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

create or replace function public.cancel_expense_allocation(p_expense_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_category text;
  v_n int;
begin
  if not public.is_admin() then
    raise exception 'Accès refusé : réservé aux administrateurs';
  end if;
  select expense_category_before into v_category from public.expense_cost_allocations where expense_id = p_expense_id limit 1;
  update public.products p set purchase_price = round(coalesce(p.purchase_price, 0) - a.amount, 2)
  from public.expense_cost_allocations a where a.expense_id = p_expense_id and a.product_id = p.id;
  get diagnostics v_n = row_count;
  delete from public.expense_cost_allocations where expense_id = p_expense_id;
  if v_n > 0 then
    update public.expenses set category = v_category where id = p_expense_id;
  end if;
  return jsonb_build_object('products_restored', v_n, 'category', v_category);
end;
$$;

revoke all on function public.allocate_expense_to_products(uuid, uuid[], boolean) from public, anon;
revoke all on function public.cancel_expense_allocation(uuid) from public, anon;
grant execute on function public.allocate_expense_to_products(uuid, uuid[], boolean) to authenticated;
grant execute on function public.cancel_expense_allocation(uuid) to authenticated;

notify pgrst, 'reload schema';
