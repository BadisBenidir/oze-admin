-- Demande de livraison marquée « Livrée » à la main par l'admin (colis parti
-- hors Sendcloud, dans un autre colis, remis en main propre…), quel que soit
-- son statut : colis non livrés passés en « delivered » via
-- apply_sendcloud_parcel_status ; sans colis, articles et demande passés
-- directement en « delivered ». Une synchro ultérieure ne fait pas redescendre.

create or replace function public.admin_mark_shipment_delivered(p_shipment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parcel record;
  v_has_parcel boolean := false;
begin
  if not public.is_admin() then
    raise exception 'Action réservée aux administrateurs';
  end if;

  for v_parcel in
    select sendcloud_parcel_id, tracking_number
    from public.shipment_parcels
    where shipment_id = p_shipment_id and status in ('label_created', 'shipped')
  loop
    v_has_parcel := true;
    perform public.apply_sendcloud_parcel_status(
      v_parcel.sendcloud_parcel_id::text,
      'delivered',
      null,
      'Livré (confirmé manuellement)',
      v_parcel.tracking_number
    );
  end loop;

  if exists (select 1 from public.shipment_parcels where shipment_id = p_shipment_id and status = 'delivered') then
    return jsonb_build_object('shipment_status', public.recompute_shipment_status(p_shipment_id));
  end if;

  -- Aucun colis Sendcloud : la demande et ses articles passent directement en livrés.
  update public.order_items
  set fulfillment_status = 'delivered',
      shipped_at = coalesce(shipped_at, now()),
      delivered_at = coalesce(delivered_at, now())
  where shipment_id = p_shipment_id
    and fulfillment_status in ('delivery_requested', 'ready_to_ship', 'received', 'label_created', 'shipped');
  update public.shipments set status = 'delivered', updated_at = now() where id = p_shipment_id;
  return jsonb_build_object('shipment_status', 'delivered');
end;
$$;

revoke all on function public.admin_mark_shipment_delivered(uuid) from public, anon;
grant execute on function public.admin_mark_shipment_delivered(uuid) to authenticated;
