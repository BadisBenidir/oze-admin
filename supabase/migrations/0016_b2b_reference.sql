-- Numéro de référence (SKU) exclusif aux produits B2B, structurellement
-- distinct de `reference` (format OZ-[MARQUE]-[NNN], partagé par le site
-- public et les étiquettes imprimables) pour ne jamais mélanger les deux
-- systèmes en inventaire/compta. Format : OZE-B2B-[ANNÉE]-[4 chiffres].
--
-- Génération garantie unique côté base (pas de boucle client avec fenêtre
-- de course) : trigger BEFORE INSERT OR UPDATE qui tire un candidat, boucle
-- jusqu'à en trouver un libre. N'écrase jamais une référence déjà attribuée
-- (traçabilité comptable stable même si le statut change ensuite).

alter table public.products add column if not exists b2b_reference text unique;

create or replace function public.generate_b2b_reference()
returns trigger
language plpgsql
as $$
declare
  v_year text := to_char(now(), 'YYYY');
  v_candidate text;
  v_attempts int := 0;
begin
  if new.status in ('for-sale-b2b', 'reserved-b2b', 'sold-b2b') and new.b2b_reference is null then
    loop
      v_candidate := 'OZE-B2B-' || v_year || '-' || lpad(floor(random() * 10000)::int::text, 4, '0');
      exit when not exists (select 1 from public.products where b2b_reference = v_candidate);
      v_attempts := v_attempts + 1;
      if v_attempts > 50 then
        raise exception 'Impossible de générer une référence B2B unique après 50 tentatives';
      end if;
    end loop;
    new.b2b_reference := v_candidate;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_generate_b2b_reference on public.products;
create trigger trg_generate_b2b_reference
before insert or update on public.products
for each row
execute function public.generate_b2b_reference();

-- Backfill : les produits B2B déjà créés avant cette migration (ex. lors
-- des tests précédents) reçoivent leur référence rétroactivement.
update public.products set status = status
where status in ('for-sale-b2b', 'reserved-b2b', 'sold-b2b') and b2b_reference is null;

-- Exposer la colonne dans le catalogue revendeur.
drop view if exists public.b2b_catalog;
create view public.b2b_catalog as
select
  p.id, p.product_code, p.reference, p.b2b_reference, p.name, p.brand_id, p.category_id, p.genre,
  p.weight, p.images, p.main_image_index, p.condition, p.description, p.colors,
  p.material, p.status, p.created_at, p.sale_price as price,
  p.defects, p.defect_images,
  exists (
    select 1 from public.b2b_cart_holds h
    where h.product_id = p.id
      and h.reseller_id <> public.current_reseller_id()
      and h.expires_at > now()
  ) as held_by_other
from public.products p
where p.status = 'for-sale-b2b'
  and exists (
    select 1 from public.reseller_contacts rc
    join public.resellers rs on rs.id = rc.reseller_id
    where rc.profile_id = auth.uid() and rs.status = 'active'
  );

grant select on public.b2b_catalog to authenticated;

notify pgrst, 'reload schema';
