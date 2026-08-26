-- ============================================================================
-- Étend encore admin_revert_item_to_received (0080/0081) : un admin peut
-- désormais annuler un article même déjà `shipped` (bordereau Sendcloud déjà
-- généré) — pour corriger une erreur de préparation après coup. L'article est
-- détaché de son shipment ET de son parcel_id, et redevient 'received'.
--
-- Différence de traitement du shipment par rapport à 0081 : si le shipment
-- se retrouve vidé de tout article ET qu'il a de VRAIS colis Sendcloud déjà
-- expédiés (shipment_parcels.status = 'shipped'), on ne le supprime plus —
-- un colis a réellement été expédié, ce justificatif (tracking, étiquette
-- réimprimable) doit rester consultable dans l'historique "Expédiées" même
-- si plus aucun article actif n'y est rattaché. Seul un shipment sans AUCUNE
-- trace d'expédition réelle est supprimé (rien à archiver).
-- ============================================================================

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
  v_shipped_count int;
  v_has_real_parcels boolean;
begin
  if not public.is_admin() then
    raise exception 'Accès refusé';
  end if;

  select array_agg(distinct shipment_id) into v_affected_shipment_ids
  from public.order_items
  where id = any(p_item_ids)
    and fulfillment_status in ('delivery_requested', 'shipped')
    and shipment_id is not null;

  with updated as (
    update public.order_items oi
    set fulfillment_status = 'received',
        ready_to_ship_at = null,
        delivery_requested_at = null,
        shipped_at = null,
        shipment_id = null,
        parcel_id = null
    from public.orders o
    where oi.order_id = o.id
      and oi.id = any(p_item_ids)
      and oi.fulfillment_status in ('ready_to_ship', 'delivery_requested', 'shipped')
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
          select 1 from public.shipment_parcels where shipment_id = v_shipment_id and status = 'shipped'
        ) into v_has_real_parcels;

        if v_has_real_parcels then
          -- Un vrai colis a été expédié pour cette demande : on conserve le
          -- shipment et ses parcels pour l'historique/le tracking, même vide
          -- de tout article actif.
          update public.shipments set status = 'shipped', updated_at = now() where id = v_shipment_id;
        else
          delete from public.shipment_parcels where shipment_id = v_shipment_id;
          delete from public.shipments where id = v_shipment_id;
        end if;
      else
        select count(*) into v_shipped_count
        from public.order_items
        where shipment_id = v_shipment_id and fulfillment_status = 'shipped';
        update public.shipments
        set status = case when v_shipped_count > 0 then 'partially_shipped' else 'requested' end,
            updated_at = now()
        where id = v_shipment_id;
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

notify pgrst, 'reload schema';
