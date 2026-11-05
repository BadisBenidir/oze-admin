-- Colis remis au transporteur confirmé à la main par l'admin, quand Sendcloud
-- tarde à remonter le premier scan (ex. Mondial Relay déposé en Point Relais,
-- encore « Announced » chez Sendcloud plusieurs heures après). Passe les colis
-- « label_created » de la demande en « shipped » via apply_sendcloud_parcel_status
-- (même logique que la synchro : articles et statut de la demande recalculés).
-- Une synchro ultérieure ne peut pas faire redescendre le statut (rang).

create or replace function public.admin_mark_shipment_handed_over(p_shipment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parcel record;
  v_count int := 0;
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'Action réservée aux administrateurs';
  end if;

  for v_parcel in
    select sendcloud_parcel_id, tracking_number
    from public.shipment_parcels
    where shipment_id = p_shipment_id and status = 'label_created'
  loop
    v_result := public.apply_sendcloud_parcel_status(
      v_parcel.sendcloud_parcel_id::text,
      'shipped',
      null,
      'Remis au transporteur (confirmé manuellement)',
      v_parcel.tracking_number
    );
    if (v_result->>'found')::boolean then
      v_count := v_count + 1;
    end if;
  end loop;

  return jsonb_build_object('parcels', v_count, 'shipment_status', public.recompute_shipment_status(p_shipment_id));
end;
$$;

revoke all on function public.admin_mark_shipment_handed_over(uuid) from public, anon;
grant execute on function public.admin_mark_shipment_handed_over(uuid) to authenticated;
