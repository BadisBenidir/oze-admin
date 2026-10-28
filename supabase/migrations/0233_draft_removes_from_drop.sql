-- ============================================================================
-- Un article d'un drop planifié ('drop-b2b', 0135) repassé à la main dans un
-- autre statut (brouillon B2B, archivé…) quitte le drop : sinon
-- execute_due_drops le mettait quand même en ligne à l'heure du drop (il
-- publie aussi les 'draft' / 'draft-b2b' de product_ids).
-- Rattrapage : articles déjà repassés en brouillon dans un drop planifié.
-- ============================================================================

create or replace function public.products_leave_planned_drop()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'drop-b2b' and new.status not in ('drop-b2b', 'for-sale-b2b') then
    update public.drops
    set product_ids = array_remove(product_ids, new.id),
        featured_product_ids = array_remove(featured_product_ids, new.id)
    where status = 'planifie' and new.id = any(product_ids);
  end if;
  return new;
end;
$$;

drop trigger if exists products_leave_planned_drop on public.products;
create trigger products_leave_planned_drop
  after update of status on public.products
  for each row execute function public.products_leave_planned_drop();

update public.drops d
set product_ids = coalesce((
      select array_agg(pid order by ord) from unnest(d.product_ids) with ordinality as u(pid, ord)
      join public.products p on p.id = u.pid
      where p.status not in ('draft', 'draft-b2b')
    ), array[]::uuid[]),
    featured_product_ids = coalesce((
      select array_agg(pid order by ord) from unnest(d.featured_product_ids) with ordinality as u(pid, ord)
      join public.products p on p.id = u.pid
      where p.status not in ('draft', 'draft-b2b')
    ), array[]::uuid[])
where d.status = 'planifie'
  and exists (select 1 from unnest(d.product_ids) pid join public.products p on p.id = pid where p.status in ('draft', 'draft-b2b'));
