-- ============================================================================
-- Étend admin_revert_item_to_received (0080, jusqu'ici limité à
-- ready_to_ship -> received) : un admin peut désormais aussi annuler un
-- article déjà inclus dans une demande de livraison en cours
-- (delivery_requested), pour corriger une erreur même après coup. Seul
-- `shipped` (bordereau déjà généré chez Sendcloud) reste verrouillé — la
-- clause `fulfillment_status in (...)` l'exclut naturellement, aucun article
-- déjà expédié ne peut donc jamais matcher.
--
-- Quand un article delivery_requested est détaché, son shipment est
-- recalculé : s'il ne contient plus aucun article (même expédié), il est
-- purement supprimé (aucun colis Sendcloud n'a jamais pu y être généré,
-- sinon ces articles seraient 'shipped' et n'auraient pas matché le filtre
-- ci-dessous) ; sinon son statut est réévalué pour rester cohérent avec ce
-- qu'il reste (partially_shipped s'il reste des colis déjà expédiés, sinon
-- requested).
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
begin
  if not public.is_admin() then
    raise exception 'Accès refusé';
  end if;

  select array_agg(distinct shipment_id) into v_affected_shipment_ids
  from public.order_items
  where id = any(p_item_ids)
    and fulfillment_status = 'delivery_requested'
    and shipment_id is not null;

  with updated as (
    update public.order_items oi
    set fulfillment_status = 'received',
        ready_to_ship_at = null,
        delivery_requested_at = null,
        shipment_id = null
    from public.orders o
    where oi.order_id = o.id
      and oi.id = any(p_item_ids)
      and oi.fulfillment_status in ('ready_to_ship', 'delivery_requested')
      and oi.status = 'active'
      and o.order_channel = 'b2b'
    returning oi.id
  )
  select array_agg(id) into v_updated_ids from updated;

  if v_affected_shipment_ids is not null then
    foreach v_shipment_id in array v_affected_shipment_ids loop
      select count(*) into v_remaining_count from public.order_items where shipment_id = v_shipment_id;
      if v_remaining_count = 0 then
        delete from public.shipment_parcels where shipment_id = v_shipment_id;
        delete from public.shipments where id = v_shipment_id;
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
