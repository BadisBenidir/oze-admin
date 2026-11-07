-- ============================================================================
-- Demande de livraison : remettre un article « prêt à la livraison ».
--
-- Cas : un article compté dans un colis (bordereau créé, voire déjà parti)
-- qui n'a finalement pas été mis dans le carton. L'admin le sort de la
-- demande : il redevient « prêt à la livraison » (le revendeur pourra le
-- redemander), sans toucher au colis ni aux autres articles.
--   - accepte delivery_requested / label_created / shipped (jamais delivered) ;
--   - removed_from_shipment_id garde la demande d'origine (0187) : la fenêtre
--     de la demande l'affiche avec « Remettre dans la demande » en cas d'erreur ;
--   - nettoyage de la demande comme admin_revert_item_to_received (0086).
-- ============================================================================

create or replace function public.admin_item_back_to_ready(p_item_ids uuid[])
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

  select array_agg(distinct oi.shipment_id) into v_affected_shipment_ids
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where oi.id = any(p_item_ids)
    and oi.fulfillment_status in ('delivery_requested', 'label_created', 'shipped')
    and oi.shipment_id is not null
    and oi.status = 'active'
    and o.order_channel = 'b2b';

  with updated as (
    update public.order_items oi
    set fulfillment_status = 'ready_to_ship',
        ready_to_ship_at = coalesce(oi.ready_to_ship_at, now()),
        delivery_requested_at = null,
        label_created_at = null,
        shipped_at = null,
        delivered_at = null,
        removed_from_shipment_id = oi.shipment_id,
        shipment_id = null,
        parcel_id = null
    from public.orders o
    where oi.order_id = o.id
      and oi.id = any(p_item_ids)
      and oi.fulfillment_status in ('delivery_requested', 'label_created', 'shipped')
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

revoke all on function public.admin_item_back_to_ready(uuid[]) from public, anon;
grant execute on function public.admin_item_back_to_ready(uuid[]) to authenticated;

notify pgrst, 'reload schema';
