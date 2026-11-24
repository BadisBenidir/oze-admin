-- ============================================================================
-- Sourcing sur mesure : journal des pièces retirées d'une mission ouverte.
--
-- Retirer une pièce proposée (avant clôture) supprime la ligne de
-- b2b_sourcing_items : on garde ici une trace — la personne n'est pas
-- intéressée, la fenêtre « Ajouter une pièce sourcée » la signale ensuite
-- pour ne pas la reproposer.
-- Non journalisés : suppression de la mission entière (cascade : la mission
-- n'existe plus au moment du trigger) et retrait après clôture (pièce absente
-- du carton, admin_sourcing_closed_remove_item) — ce n'est pas un refus.
-- ============================================================================

create table if not exists public.b2b_sourcing_removed_items (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null,
  reseller_id uuid,
  user_id uuid,
  product_id uuid not null,
  title text,
  removed_at timestamptz not null default now()
);

create index if not exists b2b_sourcing_removed_items_user_idx on public.b2b_sourcing_removed_items (user_id, product_id);
create index if not exists b2b_sourcing_removed_items_reseller_idx on public.b2b_sourcing_removed_items (reseller_id, product_id);

alter table public.b2b_sourcing_removed_items enable row level security;

drop policy if exists b2b_sourcing_removed_items_admin_all on public.b2b_sourcing_removed_items;
create policy b2b_sourcing_removed_items_admin_all on public.b2b_sourcing_removed_items
  for all using (public.is_admin()) with check (public.is_admin());

create or replace function public.log_sourcing_item_removed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mission record;
begin
  if old.product_id is null or old.status = 'cancelled' then
    return old;
  end if;
  select id, reseller_id, user_id, completed_at into v_mission
  from public.b2b_sourcing_missions where id = old.mission_id;
  if not found or v_mission.completed_at is not null then
    return old;
  end if;
  insert into public.b2b_sourcing_removed_items (mission_id, reseller_id, user_id, product_id, title)
  values (old.mission_id, v_mission.reseller_id, v_mission.user_id, old.product_id, old.title);
  return old;
end;
$$;

drop trigger if exists log_sourcing_item_removed on public.b2b_sourcing_items;
create trigger log_sourcing_item_removed
  after delete on public.b2b_sourcing_items
  for each row execute function public.log_sourcing_item_removed();

notify pgrst, 'reload schema';
