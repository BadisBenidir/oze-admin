-- ============================================================================
-- Lots de livraison B2B : regroupe automatiquement les commandes non
-- expédiées d'un même revendeur dans un même "lot" jusqu'à ce qu'il soit
-- marqué prêt par un admin. Remplace la sélection manuelle du mode de
-- livraison + l'option "commande groupée" au checkout (retirées du panier) :
-- l'adresse/le mode de livraison ne sont désormais choisis qu'au moment de la
-- demande de livraison, une fois par lot plutôt qu'une fois par commande.
--
-- Cycle de vie d'un lot :
--   open               -> créé/alimenté automatiquement à chaque commande B2B
--                          payée du revendeur (voir get_or_create_open_batch,
--                          appelée depuis confirm_b2b_payment et
--                          pay_b2b_order_with_wallet).
--   delivery_available -> l'admin clique "Livraison disponible" ; le lot
--                          arrête d'accueillir de nouvelles commandes (une
--                          commande passée après ce point ouvre un nouveau
--                          lot 'open').
--   requested          -> le revendeur clique "Demander la livraison" et
--                          choisit à ce moment l'adresse/le mode de livraison.
--   shipped / cancelled -> états terminaux, non gérés par cette migration
--                          (aucune action "marquer expédié" n'existe encore
--                          côté admin ; à ajouter plus tard si besoin).
-- ============================================================================

create table public.delivery_batches (
  id uuid primary key default gen_random_uuid(),
  reseller_id uuid not null references public.resellers(id),
  status text not null default 'open' check (status in ('open', 'delivery_available', 'requested', 'shipped', 'cancelled')),
  delivery_available_at timestamptz,
  requested_at timestamptz,
  requested_by_profile_id uuid references public.profiles(id),
  delivery_type text check (delivery_type in ('domicile', 'point_relais')),
  parcel_point jsonb,
  delivery_instructions text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_delivery_batches_reseller on public.delivery_batches(reseller_id);

-- Un seul lot 'open' par revendeur à la fois : sert de contrainte
-- d'unicité pour get_or_create_open_batch (insert ... on conflict).
create unique index uq_delivery_batches_open_per_reseller on public.delivery_batches(reseller_id) where (status = 'open');

alter table public.orders add column batch_id uuid references public.delivery_batches(id);
create index idx_orders_batch_id on public.orders(batch_id);

alter table public.delivery_batches enable row level security;

create policy "Admins can view all delivery batches"
  on public.delivery_batches for select
  using (public.is_admin());

create policy "Resellers can view their own delivery batches"
  on public.delivery_batches for select
  using (reseller_id = public.current_reseller_id());

-- Toutes les écritures passent par les fonctions ci-dessous (SECURITY
-- DEFINER) : aucune policy insert/update, comme pour le reste des flux
-- financiers/commande de ce projet (annulations, portefeuille...).

create or replace function public.get_or_create_open_batch(p_reseller_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch_id uuid;
begin
  select id into v_batch_id
  from public.delivery_batches
  where reseller_id = p_reseller_id and status = 'open'
  limit 1;

  if v_batch_id is not null then
    return v_batch_id;
  end if;

  insert into public.delivery_batches (reseller_id, status)
  values (p_reseller_id, 'open')
  on conflict (reseller_id) where (status = 'open') do nothing
  returning id into v_batch_id;

  if v_batch_id is null then
    select id into v_batch_id
    from public.delivery_batches
    where reseller_id = p_reseller_id and status = 'open'
    limit 1;
  end if;

  return v_batch_id;
end;
$$;

create or replace function public.admin_mark_delivery_available(p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Accès refusé';
  end if;

  update public.delivery_batches
  set status = 'delivery_available', delivery_available_at = now(), updated_at = now()
  where id = p_batch_id and status = 'open'
  returning id into v_updated_id;

  if v_updated_id is null then
    raise exception 'Lot introuvable ou déjà traité';
  end if;

  return jsonb_build_object('batch_id', v_updated_id);
end;
$$;

grant execute on function public.admin_mark_delivery_available(uuid) to authenticated;

create or replace function public.request_batch_delivery(
  p_batch_id uuid,
  p_delivery_type text,
  p_parcel_point jsonb default null,
  p_instructions text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reseller_id uuid;
  v_updated_id uuid;
begin
  v_reseller_id := public.current_reseller_id();
  if v_reseller_id is null then
    raise exception 'Aucun compte revendeur actif associé à cet utilisateur';
  end if;

  if p_delivery_type not in ('domicile', 'point_relais') then
    raise exception 'Mode de livraison invalide';
  end if;
  if p_delivery_type = 'point_relais' and (p_parcel_point is null or p_parcel_point->>'name' is null) then
    raise exception 'Point relais incomplet';
  end if;

  update public.delivery_batches
  set status = 'requested',
      requested_at = now(),
      requested_by_profile_id = auth.uid(),
      delivery_type = p_delivery_type,
      parcel_point = p_parcel_point,
      delivery_instructions = p_instructions,
      updated_at = now()
  where id = p_batch_id
    and reseller_id = v_reseller_id
    and status = 'delivery_available'
  returning id into v_updated_id;

  if v_updated_id is null then
    raise exception 'Ce lot n''est pas disponible pour une demande de livraison';
  end if;

  return jsonb_build_object('batch_id', v_updated_id);
end;
$$;

grant execute on function public.request_batch_delivery(uuid, text, jsonb, text) to authenticated;

notify pgrst, 'reload schema';
