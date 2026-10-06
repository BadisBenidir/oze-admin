-- ============================================================================
-- Demande de livraison : retirer UN article pas encore reçu à l'atelier.
--
-- L'article repasse "en acheminement" (fulfillment_status = 'ordered'), comme
-- l'annulation d'une demande entière (0159) : il devra être réceptionné puis
-- pointé prêt avant toute nouvelle demande — le revendeur ne peut donc PAS le
-- redemander tout de suite. Le revendeur est prévenu tout de suite, puis une
-- seconde fois dès que l'article est réellement prêt (trigger
-- notify_redelivery_ready de 0159, via redelivery_notice_profile_id).
--
-- Le reste de la demande est conservé (les frais de port restent acquis pour
-- les autres articles). Retirer le DERNIER article est refusé : il faut alors
-- « Annuler la demande » (0159), qui gère le remboursement des frais de port.
-- ============================================================================

create or replace function public.admin_return_requested_items_to_transit(p_item_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shipment record;
  v_items jsonb;
  v_item_ids uuid[];
  v_remaining int;
begin
  if not public.is_admin() then
    raise exception 'Accès refusé';
  end if;

  for v_shipment in
    select distinct s.id, s.reseller_id, s.requested_by_profile_id
    from public.order_items oi
    join public.shipments s on s.id = oi.shipment_id
    where oi.id = any(p_item_ids)
      and oi.fulfillment_status = 'delivery_requested'
      and oi.status = 'active'
  loop
    select
      coalesce(jsonb_agg(jsonb_build_object(
        'reference', coalesce(p.b2b_reference, p.reference, p.product_code, oi.product_snapshot->>'reference', oi.product_snapshot->>'product_code', '—'),
        'name', coalesce(p.name, oi.product_snapshot->>'name', 'Article')
      ) order by oi.id), '[]'::jsonb),
      array_agg(oi.id)
    into v_items, v_item_ids
    from public.order_items oi
    left join public.products p on p.id = oi.product_id
    where oi.id = any(p_item_ids)
      and oi.shipment_id = v_shipment.id
      and oi.fulfillment_status = 'delivery_requested'
      and oi.status = 'active';

    select count(*) into v_remaining
    from public.order_items
    where shipment_id = v_shipment.id
      and status = 'active'
      and not (id = any(v_item_ids));

    if v_remaining = 0 then
      raise exception 'C''est le dernier article de la demande : utilisez « Annuler la demande » (remboursement des frais de port possible)';
    end if;

    update public.order_items
    set fulfillment_status = 'ordered',
        received_at = null,
        ready_to_ship_at = null,
        delivery_requested_at = null,
        shipment_id = null,
        parcel_id = null,
        redelivery_notice_profile_id = v_shipment.requested_by_profile_id
    where id = any(v_item_ids);

    perform public.recompute_shipment_status(v_shipment.id);

    if v_shipment.requested_by_profile_id is not null then
      insert into public.reseller_notifications (profile_id, reseller_id, type, title, message, payload)
      values (
        v_shipment.requested_by_profile_id,
        v_shipment.reseller_id,
        'delivery_request_cancelled',
        'Information sur votre demande de livraison',
        'Les articles suivants ne sont pas encore arrivés à notre atelier : ils ont été retirés de votre demande de livraison, le reste de la demande est expédié normalement. Vous serez notifié dès leur réception pour les faire livrer.',
        jsonb_build_object('shipment_id', v_shipment.id, 'items', v_items)
      );
    end if;
  end loop;

  return jsonb_build_object('updated_count', (
    select count(*) from public.order_items where id = any(p_item_ids) and fulfillment_status = 'ordered'
  ));
end;
$$;

revoke all on function public.admin_return_requested_items_to_transit(uuid[]) from public, anon;
grant execute on function public.admin_return_requested_items_to_transit(uuid[]) to authenticated;

notify pgrst, 'reload schema';
