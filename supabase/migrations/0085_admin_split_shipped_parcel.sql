-- ============================================================================
-- Permet de scinder une expédition APRÈS coup : quand un premier colis a déjà
-- été généré (étiquette Sendcloud émise) pour tous les articles d'une demande
-- de livraison, mais qu'ils ne tiennent physiquement pas dans un seul carton,
-- l'admin doit pouvoir sélectionner certains articles déjà "shipped" et les
-- faire basculer vers un NOUVEAU colis — sans toucher au premier
-- (shipment_parcels et son étiquette/tracking restent intacts, seuls les
-- order_items déplacés perdent leur parcel_id).
--
-- Différence avec admin_revert_item_to_received (0080/0081/0082) : celle-ci
-- détache complètement l'article de son shipment (fulfillment_status =
-- 'received', shipment_id = null) — il faudrait re-payer une nouvelle
-- demande de livraison pour le réexpédier. Ici, l'article reste rattaché à
-- LA MÊME demande (shipment_id inchangé) et repasse seulement en
-- 'delivery_requested' avec parcel_id vidé : generate-b2b-shipment-labels
-- (qui exige déjà fulfillment_status = 'delivery_requested' et calcule déjà
-- parcel_index dynamiquement comme max+1 par shipment) peut alors lui
-- générer un colis suivant directement, sans aucune modification côté edge
-- function.
-- ============================================================================

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
  v_remaining_shipped_count int;
begin
  if not public.is_admin() then
    raise exception 'Accès refusé';
  end if;

  select array_agg(distinct oi.shipment_id) into v_affected_shipment_ids
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where oi.id = any(p_item_ids)
    and oi.fulfillment_status = 'shipped'
    and oi.shipment_id is not null
    and oi.status = 'active'
    and o.order_channel = 'b2b';

  with updated as (
    update public.order_items oi
    set fulfillment_status = 'delivery_requested',
        parcel_id = null,
        shipped_at = null
    from public.orders o
    where oi.order_id = o.id
      and oi.id = any(p_item_ids)
      and oi.fulfillment_status = 'shipped'
      and oi.status = 'active'
      and o.order_channel = 'b2b'
    returning oi.id
  )
  select array_agg(id) into v_updated_ids from updated;

  -- Le colis d'origine (shipment_parcels) n'est jamais modifié ni supprimé
  -- ici : seuls les order_items déplacés perdent leur parcel_id. Le
  -- shipment lui-même redescend en 'partially_shipped' (ou 'requested' si
  -- plus rien n'est expédié dessus) pour refléter qu'il reste des articles
  -- à emballer.
  if v_affected_shipment_ids is not null then
    foreach v_shipment_id in array v_affected_shipment_ids loop
      select count(*) into v_remaining_shipped_count
      from public.order_items
      where shipment_id = v_shipment_id and fulfillment_status = 'shipped';

      update public.shipments
      set status = case when v_remaining_shipped_count > 0 then 'partially_shipped' else 'requested' end,
          updated_at = now()
      where id = v_shipment_id;
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
