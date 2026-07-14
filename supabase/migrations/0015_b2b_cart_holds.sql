-- Verrou logiciel "dans le panier d'un autre revendeur" : purement indicatif
-- côté UI (désactive le bouton "Ajouter"), n'est PAS la réservation réelle de
-- l'inventaire — celle-ci reste, comme décidé précédemment, effectuée
-- atomiquement au moment du paiement Stripe (confirm_b2b_payment). Ce hold
-- expire de lui-même après 15 min (aligné sur le timer du panier côté
-- front) : pas besoin de job de nettoyage, chaque lecture/écriture purge au
-- passage les entrées expirées.

create table if not exists public.b2b_cart_holds (
  product_id uuid primary key references public.products (id) on delete cascade,
  reseller_id uuid not null references public.resellers (id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.b2b_cart_holds enable row level security;
-- Aucune policy directe : cette table n'est jamais lue/écrite par le client
-- directement, uniquement via les fonctions security definer ci-dessous et
-- la colonne calculée de b2b_catalog (qui s'exécute avec les droits du
-- propriétaire de la vue, comme reseller_contacts/resellers déjà).

create or replace function public.hold_b2b_cart_item(p_product_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reseller_id uuid;
begin
  v_reseller_id := public.current_reseller_id();
  if v_reseller_id is null then
    raise exception 'Accès refusé : aucun compte revendeur actif';
  end if;

  delete from public.b2b_cart_holds where expires_at <= now();

  if exists (
    select 1 from public.b2b_cart_holds
    where product_id = p_product_id and reseller_id <> v_reseller_id
  ) then
    raise exception 'Cet article est actuellement réservé par un autre revendeur.';
  end if;

  insert into public.b2b_cart_holds (product_id, reseller_id, expires_at)
  values (p_product_id, v_reseller_id, now() + interval '15 minutes')
  on conflict (product_id) do update
    set expires_at = excluded.expires_at
    where public.b2b_cart_holds.reseller_id = excluded.reseller_id;
end;
$$;

create or replace function public.release_b2b_cart_item(p_product_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reseller_id uuid;
begin
  v_reseller_id := public.current_reseller_id();
  if v_reseller_id is null then
    return;
  end if;

  delete from public.b2b_cart_holds
  where product_id = p_product_id and reseller_id = v_reseller_id;
end;
$$;

grant execute on function public.hold_b2b_cart_item(uuid) to authenticated;
grant execute on function public.release_b2b_cart_item(uuid) to authenticated;

-- b2b_catalog expose désormais `held_by_other` : vrai si un AUTRE revendeur
-- (actif, hold non expiré) a déjà cet article dans son panier.
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
