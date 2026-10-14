-- ============================================================================
-- Changements de prix programmés du catalogue B2B.
--
-- L'admin filtre le catalogue, choisit des articles, saisit le nouveau prix
-- de CHACUN et une date/heure : à l'heure dite, apply_due_b2b_price_changes
-- (pg_cron, chaque minute — même mécanisme que execute_due_drops, 0031)
-- remplace products.sale_price, qui est le prix du catalogue B2B
-- (b2b_catalog : catalog_price = sale_price). Pas d'annonce ni de garde-fou
-- automatique : c'est l'admin qui fixe chaque prix.
--
-- Un article qui n'est plus en vente B2B à l'heure dite (vendu, retiré,
-- réservé) n'est pas modifié : la ligne passe 'skipped'. old_price garde le
-- prix remplacé (historique).
-- ============================================================================

create table if not exists public.b2b_price_changes (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  new_price numeric(10, 2) not null check (new_price > 0),
  scheduled_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'applied', 'skipped', 'cancelled')),
  old_price numeric(10, 2),
  applied_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists b2b_price_changes_due_idx
  on public.b2b_price_changes (scheduled_at) where status = 'scheduled';

-- Un seul changement programmé à la fois par article (le reprogrammer
-- remplace l'ancien, voir la page admin).
create unique index if not exists b2b_price_changes_one_scheduled_per_product
  on public.b2b_price_changes (product_id) where status = 'scheduled';

alter table public.b2b_price_changes enable row level security;

drop policy if exists b2b_price_changes_admin_all on public.b2b_price_changes;
create policy b2b_price_changes_admin_all on public.b2b_price_changes
  for all using (public.is_admin()) with check (public.is_admin());

create or replace function public.apply_due_b2b_price_changes()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_applied int := 0;
  v_skipped int := 0;
  v_change record;
  v_product record;
begin
  for v_change in
    select * from public.b2b_price_changes
    where status = 'scheduled' and scheduled_at <= now()
    order by scheduled_at
    for update skip locked
  loop
    select id, status, sale_price into v_product from public.products where id = v_change.product_id for update;
    if not found or v_product.status <> 'for-sale-b2b' then
      update public.b2b_price_changes
      set status = 'skipped', old_price = v_product.sale_price, applied_at = now()
      where id = v_change.id;
      v_skipped := v_skipped + 1;
      continue;
    end if;

    update public.products set sale_price = v_change.new_price, updated_at = now() where id = v_change.product_id;
    update public.b2b_price_changes
    set status = 'applied', old_price = v_product.sale_price, applied_at = now()
    where id = v_change.id;
    v_applied := v_applied + 1;
  end loop;

  return jsonb_build_object('applied', v_applied, 'skipped', v_skipped);
end;
$$;

revoke all on function public.apply_due_b2b_price_changes() from public, anon, authenticated;

do $$
begin
  perform cron.unschedule('apply-due-b2b-price-changes')
  where exists (select 1 from cron.job where jobname = 'apply-due-b2b-price-changes');
  perform cron.schedule('apply-due-b2b-price-changes', '* * * * *', 'select public.apply_due_b2b_price_changes()');
exception when others then
  raise notice 'Impossible de programmer apply-due-b2b-price-changes via pg_cron — à faire manuellement via cron.schedule().';
end $$;

notify pgrst, 'reload schema';
