-- ============================================================================
-- Corrige le cycle de vie des statuts d'expédition : jusqu'ici,
-- generate-b2b-shipment-labels faisait passer order_items.fulfillment_status
-- ET shipment_parcels.status directement à 'shipped' dès la CRÉATION du
-- bordereau Sendcloud (avant même le dépôt réel chez le transporteur), et
-- rien ne faisait jamais évoluer ce statut vers "livré" par la suite.
--
-- Nouveau cycle, sur order_items.fulfillment_status ET shipment_parcels.status :
--   ordered -> received -> ready_to_ship -> delivery_requested
--     -> label_created  (NOUVEAU : bordereau imprimé, pas encore pris en charge)
--     -> shipped        (RE-SÉMANTISÉ : vraiment pris en charge par le
--                         transporteur — posé par le webhook/sync Sendcloud,
--                         plus par la génération de l'étiquette)
--     -> delivered       (NOUVEAU : remis au destinataire / retiré en point relais)
--
-- shipments.status (agrégat) devient 'requested' | 'preparing' | 'in_transit'
-- | 'delivered' (remplace 'partially_shipped'/l'ancien sens de 'shipped').
--
-- shipment_parcels.shipped_at avait le même problème de sens (posé à la
-- création du bordereau) : renommé label_created_at, un nouveau shipped_at
-- est ajouté avec le sens correct (prise en charge réelle) — voir points 1-2.
-- order_items.shipped_at n'est PAS renommé (aucune lecture nommée ailleurs
-- dans le code, seulement des select('*')) : ses valeurs historiques
-- (= date de création du bordereau) sont migrées vers un nouveau
-- label_created_at, puis shipped_at est vidé pour ces lignes — il ne sera
-- reposé que par une vraie prise en charge, comme sur shipment_parcels.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. order_items : nouvelles colonnes, backfill, puis contrainte élargie.
-- ----------------------------------------------------------------------------
alter table public.order_items add column if not exists label_created_at timestamptz;
alter table public.order_items add column if not exists delivered_at timestamptz;

do $$
declare
  v_conname text;
begin
  select conname into v_conname
  from pg_constraint
  where conrelid = 'public.order_items'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%fulfillment_status%';
  if v_conname is not null then
    execute format('alter table public.order_items drop constraint %I', v_conname);
  end if;
end $$;

alter table public.order_items
  add constraint order_items_fulfillment_status_check
  check (fulfillment_status in ('ordered', 'received', 'ready_to_ship', 'delivery_requested', 'label_created', 'shipped', 'delivered'));

-- Backfill : toute ligne 'shipped' existante ne représentait qu'une étiquette
-- imprimée (ancien comportement de generate-b2b-shipment-labels) — jamais une
-- vraie prise en charge, qu'on ne peut pas déduire rétroactivement sans
-- interroger Sendcloud (voir sendcloud-sync-tracking, à lancer après cette
-- migration pour rattraper l'état réel des colis encore en cours).
update public.order_items
set label_created_at = shipped_at,
    shipped_at = null,
    fulfillment_status = 'label_created'
where fulfillment_status = 'shipped';

-- ----------------------------------------------------------------------------
-- 2. shipment_parcels : renomme shipped_at (même correction de sens), ajoute
-- delivered_at + les champs de diagnostic Sendcloud bruts, puis élargit la
-- contrainte et bascule les lignes existantes.
-- ----------------------------------------------------------------------------
alter table public.shipment_parcels rename column shipped_at to label_created_at;
alter table public.shipment_parcels add column if not exists shipped_at timestamptz;
alter table public.shipment_parcels add column if not exists delivered_at timestamptz;
alter table public.shipment_parcels add column if not exists carrier_status_code text;
alter table public.shipment_parcels add column if not exists carrier_status_message text;

do $$
declare
  v_conname text;
begin
  select conname into v_conname
  from pg_constraint
  where conrelid = 'public.shipment_parcels'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%status%'
    and pg_get_constraintdef(oid) ilike '%pending%';
  if v_conname is not null then
    execute format('alter table public.shipment_parcels drop constraint %I', v_conname);
  end if;
end $$;

alter table public.shipment_parcels
  add constraint shipment_parcels_status_check
  check (status in ('pending', 'label_created', 'shipped', 'delivered', 'failed'));

update public.shipment_parcels set status = 'label_created' where status = 'shipped';

-- ----------------------------------------------------------------------------
-- 3. shipments (agrégat) : nouveau vocabulaire à 4 états.
-- ----------------------------------------------------------------------------
do $$
declare
  v_conname text;
begin
  select conname into v_conname
  from pg_constraint
  where conrelid = 'public.shipments'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%status%'
    and pg_get_constraintdef(oid) ilike '%requested%';
  if v_conname is not null then
    execute format('alter table public.shipments drop constraint %I', v_conname);
  end if;
end $$;

alter table public.shipments
  add constraint shipments_status_check
  check (status in ('requested', 'preparing', 'in_transit', 'delivered'));

update public.shipments set status = 'preparing' where status in ('partially_shipped', 'shipped');

-- ----------------------------------------------------------------------------
-- 4. recompute_shipment_status : logique d'agrégation partagée, appelée par
-- generate-b2b-shipment-labels (après création d'étiquette), par
-- apply_sendcloud_parcel_status (après un événement de tracking), et par les
-- RPCs de correction admin (revert / unassign) — un seul endroit qui décide
-- comment un statut d'ensemble se déduit des colis réels, plutôt que de
-- dupliquer cette règle à 4 endroits.
-- ----------------------------------------------------------------------------
create or replace function public.recompute_shipment_status(p_shipment_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_has_real_parcel boolean;
  v_has_shipped_or_delivered boolean;
  v_all_delivered boolean;
  v_new_status text;
begin
  select
    exists(select 1 from public.shipment_parcels where shipment_id = p_shipment_id and status in ('label_created', 'shipped', 'delivered')),
    exists(select 1 from public.shipment_parcels where shipment_id = p_shipment_id and status in ('shipped', 'delivered')),
    (
      exists(select 1 from public.shipment_parcels where shipment_id = p_shipment_id and status in ('label_created', 'shipped', 'delivered'))
      and not exists(select 1 from public.shipment_parcels where shipment_id = p_shipment_id and status in ('label_created', 'shipped'))
    )
  into v_has_real_parcel, v_has_shipped_or_delivered, v_all_delivered;

  if v_all_delivered then
    v_new_status := 'delivered';
  elsif v_has_shipped_or_delivered then
    v_new_status := 'in_transit';
  elsif v_has_real_parcel then
    v_new_status := 'preparing';
  else
    v_new_status := 'requested';
  end if;

  update public.shipments set status = v_new_status, updated_at = now() where id = p_shipment_id;
  return v_new_status;
end;
$$;

revoke all on function public.recompute_shipment_status(uuid) from public, anon, authenticated;
grant execute on function public.recompute_shipment_status(uuid) to service_role, authenticated;

-- ----------------------------------------------------------------------------
-- 5. apply_sendcloud_parcel_status : point d'entrée unique pour le webhook ET
-- la synchronisation manuelle — jamais appelable directement par un
-- revendeur/admin depuis le navigateur (p_new_status n'est jamais re-dérivé
-- d'auth.uid(), donc réservé à service_role, exactement comme
-- finalize_b2b_delivery_request/finalize_entrupy_certificate_request).
-- N'avance JAMAIS en arrière (delivered ne peut pas redevenir shipped) : un
-- événement de tracking en désordre ou dupliqué ne peut que confirmer/avancer
-- l'état, jamais le régresser.
-- ----------------------------------------------------------------------------
create or replace function public.apply_sendcloud_parcel_status(
  p_sendcloud_parcel_id text,
  p_new_status text,
  p_carrier_status_code text default null,
  p_carrier_status_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parcel record;
  v_rank_current int;
  v_rank_new int;
  v_shipment_status text;
begin
  if p_new_status is not null and p_new_status not in ('label_created', 'shipped', 'delivered') then
    raise exception 'Statut invalide : %', p_new_status;
  end if;

  select id, shipment_id, status into v_parcel
  from public.shipment_parcels
  where sendcloud_parcel_id = p_sendcloud_parcel_id
  for update;

  if v_parcel.id is null then
    return jsonb_build_object('found', false);
  end if;

  -- Toujours rafraîchir le code/message brut, même si le statut classifié
  -- n'avance pas (ou n'a pas pu être classifié côté appelant) — utile pour le
  -- diagnostic admin dans tous les cas.
  update public.shipment_parcels
  set carrier_status_code = coalesce(p_carrier_status_code, carrier_status_code),
      carrier_status_message = coalesce(p_carrier_status_message, carrier_status_message),
      updated_at = now()
  where id = v_parcel.id;

  if p_new_status is not null then
    v_rank_current := case v_parcel.status when 'label_created' then 1 when 'shipped' then 2 when 'delivered' then 3 else 0 end;
    v_rank_new := case p_new_status when 'label_created' then 1 when 'shipped' then 2 when 'delivered' then 3 else 0 end;

    if v_rank_new > v_rank_current then
      update public.shipment_parcels
      set status = p_new_status,
          shipped_at = case when p_new_status = 'shipped' and shipped_at is null then now() else shipped_at end,
          delivered_at = case when p_new_status = 'delivered' and delivered_at is null then now() else delivered_at end
      where id = v_parcel.id;

      update public.order_items
      set fulfillment_status = p_new_status,
          shipped_at = case when p_new_status = 'shipped' and shipped_at is null then now() else shipped_at end,
          delivered_at = case when p_new_status = 'delivered' and delivered_at is null then now() else delivered_at end
      where parcel_id = v_parcel.id;
    end if;
  end if;

  v_shipment_status := public.recompute_shipment_status(v_parcel.shipment_id);

  return jsonb_build_object('found', true, 'parcel_id', v_parcel.id, 'shipment_id', v_parcel.shipment_id, 'shipment_status', v_shipment_status);
end;
$$;

revoke all on function public.apply_sendcloud_parcel_status(text, text, text, text) from public, anon, authenticated;
grant execute on function public.apply_sendcloud_parcel_status(text, text, text, text) to service_role;

-- ----------------------------------------------------------------------------
-- 6. admin_revert_item_to_received : ne peut plus revenir sur un colis
-- VRAIMENT parti (shipped) ou livré (delivered) — seulement tant qu'il n'est
-- encore qu'une étiquette imprimée (label_created) ou pas encore emballé.
-- Avant cette migration, 'shipped' ne signifiait que "étiquette imprimée",
-- donc l'autoriser avait du sens ; maintenant que 'shipped' veut dire "parti
-- chez le transporteur", revenir en arrière n'a plus de sens physique.
-- Corps sinon repris à l'identique de la version 0082, avec
-- recompute_shipment_status en remplacement du calcul de statut inline.
-- ----------------------------------------------------------------------------
create or replace function public.admin_revert_item_to_received(p_item_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated_ids uuid[];
  v_affected_shipment_ids uuid[];
  v_shipment_id uuid;
  v_remaining_count int;
  v_has_real_parcels boolean;
begin
  if not public.is_admin() then
    raise exception 'Accès refusé';
  end if;

  select array_agg(distinct shipment_id) into v_affected_shipment_ids
  from public.order_items
  where id = any(p_item_ids)
    and fulfillment_status in ('delivery_requested', 'label_created')
    and shipment_id is not null;

  with updated as (
    update public.order_items oi
    set fulfillment_status = 'received',
        ready_to_ship_at = null,
        delivery_requested_at = null,
        label_created_at = null,
        shipped_at = null,
        delivered_at = null,
        shipment_id = null,
        parcel_id = null
    from public.orders o
    where oi.order_id = o.id
      and oi.id = any(p_item_ids)
      and oi.fulfillment_status in ('ready_to_ship', 'delivery_requested', 'label_created')
      and oi.status = 'active'
      and o.order_channel = 'b2b'
    returning oi.id
  )
  select array_agg(id) into v_updated_ids from updated;

  if v_affected_shipment_ids is not null then
    foreach v_shipment_id in array v_affected_shipment_ids loop
      select count(*) into v_remaining_count from public.order_items where shipment_id = v_shipment_id;

      if v_remaining_count = 0 then
        select exists(
          select 1 from public.shipment_parcels where shipment_id = v_shipment_id and status in ('label_created', 'shipped', 'delivered')
        ) into v_has_real_parcels;

        if v_has_real_parcels then
          -- Un vrai colis existe pour cette demande : on conserve le shipment
          -- et ses parcels pour l'historique/le tracking, même vide de tout
          -- article actif. recompute_shipment_status calcule le bon statut
          -- ('preparing'/'in_transit'/'delivered') à partir des colis restants.
          perform public.recompute_shipment_status(v_shipment_id);
        else
          delete from public.shipment_parcels where shipment_id = v_shipment_id;
          delete from public.shipments where id = v_shipment_id;
        end if;
      else
        perform public.recompute_shipment_status(v_shipment_id);
      end if;
    end loop;
  end if;

  return jsonb_build_object(
    'updated_ids', to_jsonb(coalesce(v_updated_ids, array[]::uuid[])),
    'updated_count', coalesce(array_length(v_updated_ids, 1), 0)
  );
end;
$$;

grant execute on function public.admin_revert_item_to_received(uuid[]) to authenticated;

-- ----------------------------------------------------------------------------
-- 7. admin_unassign_items_from_parcel : élargi à 'label_created' (le cas le
-- plus courant en pratique — un bordereau vient d'être imprimé, pas encore
-- déposé, et il faut finalement 2 cartons) en plus de 'shipped' (correction
-- de bookkeeping sur un colis déjà réellement parti, plus rare mais toujours
-- utile pour un admin). Jamais 'delivered' : rien à corriger sur un article
-- déjà remis au client. Corps sinon repris de la version 0085.
-- ----------------------------------------------------------------------------
create or replace function public.admin_unassign_items_from_parcel(p_item_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated_ids uuid[];
  v_affected_shipment_ids uuid[];
  v_shipment_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Accès refusé';
  end if;

  select array_agg(distinct oi.shipment_id) into v_affected_shipment_ids
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where oi.id = any(p_item_ids)
    and oi.fulfillment_status in ('label_created', 'shipped')
    and oi.shipment_id is not null
    and oi.status = 'active'
    and o.order_channel = 'b2b';

  with updated as (
    update public.order_items oi
    set fulfillment_status = 'delivery_requested',
        parcel_id = null,
        label_created_at = null,
        shipped_at = null,
        delivered_at = null
    from public.orders o
    where oi.order_id = o.id
      and oi.id = any(p_item_ids)
      and oi.fulfillment_status in ('label_created', 'shipped')
      and oi.status = 'active'
      and o.order_channel = 'b2b'
    returning oi.id
  )
  select array_agg(id) into v_updated_ids from updated;

  if v_affected_shipment_ids is not null then
    foreach v_shipment_id in array v_affected_shipment_ids loop
      perform public.recompute_shipment_status(v_shipment_id);
    end loop;
  end if;

  return jsonb_build_object(
    'updated_ids', to_jsonb(coalesce(v_updated_ids, array[]::uuid[])),
    'updated_count', coalesce(array_length(v_updated_ids, 1), 0)
  );
end;
$$;

grant execute on function public.admin_unassign_items_from_parcel(uuid[]) to authenticated;

notify pgrst, 'reload schema';
