-- ============================================================================
-- Enchères : ordre d'affichage des lots choisi par l'admin (flèches ↑↓ dans
-- « Sessions & Lots »). Les lots étaient triés par date d'ajout.
--
--   - position : rang du lot dans sa session (1 = premier) ;
--   - les lots existants reprennent l'ordre d'ajout ;
--   - un nouveau lot se place automatiquement en dernier ;
--   - exposée aux revendeurs via reseller_auction_items (tri de la page Enchères).
-- ============================================================================

alter table public.auction_items add column if not exists position integer;

update public.auction_items ai
set position = ranked.rn
from (
  select id, row_number() over (partition by session_id order by created_at, id) as rn
  from public.auction_items
) ranked
where ranked.id = ai.id and ai.position is null;

create or replace function public.set_auction_item_position()
returns trigger
language plpgsql
as $$
begin
  if new.position is null then
    select coalesce(max(position), 0) + 1 into new.position
    from public.auction_items
    where session_id = new.session_id;
  end if;
  return new;
end;
$$;

drop trigger if exists auction_items_set_position on public.auction_items;
create trigger auction_items_set_position
before insert on public.auction_items
for each row execute function public.set_auction_item_position();

-- Vue revendeur (0107) : même colonnes + position, ajoutée en fin de liste.
create or replace view public.reseller_auction_items as
select
  ai.id,
  ai.session_id,
  ai.title,
  ai.brand,
  ai.grade,
  ai.images,
  ai.start_price,
  ai.current_price,
  ai.min_increment,
  ai.current_winner_id,
  ai.ends_at,
  ai.status,
  ai.created_at,
  p.description,
  p.material,
  p.colors,
  p.serial_number,
  ai.position
from public.auction_items ai
left join public.products p on p.id = ai.product_id
where public.current_reseller_id() is not null;

grant select on public.reseller_auction_items to authenticated;

notify pgrst, 'reload schema';
