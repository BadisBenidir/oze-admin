-- Fix : un article unique pouvait finir dans DEUX paniers en même temps.
--
-- hold_b2b_cart_item bloquait uniquement les AUTRES ENTREPRISES
-- (reseller_id <> v_reseller_id) — deux collègues d'un même revendeur (ex.
-- le contact principal et un sous-compte invité) ne se bloquaient jamais
-- entre eux. Ça n'avait pas d'impact tant que le panier était partagé au
-- niveau entreprise, mais depuis que useB2BCart est scopé par profil
-- individuel, ça laissait chaque collègue ajouter la même pièce unique dans
-- SON propre panier sans contention. Le verrou doit être exclusif à
-- l'échelle du site, par PROFIL, pas par entreprise.
--
-- Deuxième bug corrigé au passage : l'ancien `on conflict (product_id) do
-- update ... where reseller_id = excluded.reseller_id` échoue silencieusement
-- (0 ligne affectée, aucune erreur) quand la ligne en conflit appartient à
-- quelqu'un d'autre — deux requêtes concurrentes pouvaient donc se croiser
-- sans qu'aucune des deux ne voie d'erreur. Remplacé par `on conflict do
-- nothing` + vérification explicite du propriétaire réel après coup, qui
-- s'appuie sur la contrainte d'unicité de Postgres pour sérialiser les
-- écritures concurrentes sur la même ligne (l'une attend que l'autre
-- commite avant de pouvoir lire l'état à jour).

alter table public.b2b_cart_holds add column if not exists profile_id uuid references public.profiles (id) on delete cascade;

-- Table purement indicative et éphémère (hold de 15 min) : on repart d'un
-- état vide plutôt que de tenter un backfill impossible (un reseller_id ne
-- dit pas quel profil précis détenait le hold).
truncate table public.b2b_cart_holds;

alter table public.b2b_cart_holds alter column profile_id set not null;
create index if not exists idx_b2b_cart_holds_profile_id on public.b2b_cart_holds (profile_id);

create or replace function public.hold_b2b_cart_item(p_product_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reseller_id uuid;
  v_uid uuid := auth.uid();
  v_existing_profile_id uuid;
begin
  v_reseller_id := public.current_reseller_id();
  if v_reseller_id is null then
    raise exception 'Accès refusé : aucun compte revendeur actif';
  end if;

  delete from public.b2b_cart_holds where expires_at <= now();

  insert into public.b2b_cart_holds (product_id, reseller_id, profile_id, expires_at)
  values (p_product_id, v_reseller_id, v_uid, now() + interval '15 minutes')
  on conflict (product_id) do nothing;

  if not found then
    -- Un hold existe déjà pour ce produit : à qui appartient-il réellement ?
    -- (la ligne verrouillée par l'INSERT ci-dessus garantit qu'on lit ici
    -- l'état déjà commité, pas une version obsolète.)
    select profile_id into v_existing_profile_id
    from public.b2b_cart_holds
    where product_id = p_product_id;

    if v_existing_profile_id = v_uid then
      -- Déjà notre propre hold (ex. re-clic) : on rafraîchit simplement le chrono.
      update public.b2b_cart_holds
      set expires_at = now() + interval '15 minutes'
      where product_id = p_product_id and profile_id = v_uid;
    else
      raise exception 'Cet article vient d''être réservé dans un autre panier.';
    end if;
  end if;
end;
$$;

create or replace function public.release_b2b_cart_item(p_product_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.b2b_cart_holds
  where product_id = p_product_id and profile_id = auth.uid();
end;
$$;

-- held_by_other : exclusif par PROFIL (site entier), plus par entreprise.
drop view if exists public.b2b_catalog;
create view public.b2b_catalog as
select
  p.id, p.product_code, p.reference, p.name, p.brand_id, p.category_id, p.genre,
  p.weight, p.images, p.main_image_index, p.condition, p.description, p.colors,
  p.material, p.status, p.created_at, p.sale_price as price,
  p.defects, p.defect_images,
  exists (
    select 1 from public.b2b_cart_holds h
    where h.product_id = p.id
      and h.profile_id <> auth.uid()
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
