-- ============================================================================
-- Correctif de sécurité immédiat : le test live après 0065 a montré que
-- `revoke ... from public, authenticated` ne suffisait pas à bloquer le
-- rôle `anon` (PostgREST associe les appels non authentifiés au rôle anon,
-- distinct de authenticated) — un appel avec la seule clé anonyme atteignait
-- déjà l'exécution de la fonction (erreur SQL réelle en retour, pas un refus
-- de permission). Cette fonction fait confiance à ses paramètres
-- (reseller_id, shipping_cost...) sans les rederiver d'auth.uid() : elle ne
-- doit être appelable que par service_role (le webhook Stripe).
-- Corrige aussi le bug SQL découvert au passage : `for update of oi` est
-- invalide avec `array_agg` (agrégat) dans la même requête.
-- ============================================================================

revoke all on function public.finalize_b2b_delivery_request(uuid[], uuid, uuid, text, jsonb, text, numeric, text) from public, anon, authenticated;
grant execute on function public.finalize_b2b_delivery_request(uuid[], uuid, uuid, text, jsonb, text, numeric, text) to service_role;

create or replace function public.finalize_b2b_delivery_request(
  p_item_ids uuid[],
  p_reseller_id uuid,
  p_profile_id uuid,
  p_delivery_type text,
  p_parcel_point jsonb,
  p_instructions text,
  p_shipping_cost numeric,
  p_stripe_session_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_shipment_id uuid;
  v_eligible_ids uuid[];
  v_shipment_id uuid;
begin
  select id into v_existing_shipment_id from public.shipments where stripe_session_id = p_stripe_session_id;
  if v_existing_shipment_id is not null then
    return jsonb_build_object('shipment_id', v_existing_shipment_id, 'already_processed', true);
  end if;

  if p_delivery_type not in ('domicile', 'point_relais') then
    raise exception 'Mode de livraison invalide';
  end if;

  -- Verrouille d'abord les lignes concernées (sans agrégat), puis agrège :
  -- FOR UPDATE ne peut pas cohabiter avec array_agg dans la même requête.
  perform 1
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where oi.id = any(p_item_ids)
    and oi.fulfillment_status = 'ready_to_ship'
    and oi.status = 'active'
    and o.order_channel = 'b2b'
    and o.reseller_id = p_reseller_id
  for update of oi;

  select array_agg(oi.id) into v_eligible_ids
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where oi.id = any(p_item_ids)
    and oi.fulfillment_status = 'ready_to_ship'
    and oi.status = 'active'
    and o.order_channel = 'b2b'
    and o.reseller_id = p_reseller_id;

  if v_eligible_ids is null or array_length(v_eligible_ids, 1) <> array_length(p_item_ids, 1) then
    raise exception 'Certains articles ne sont plus disponibles pour une demande de livraison';
  end if;

  insert into public.shipments (
    reseller_id, requested_by_profile_id, delivery_type, parcel_point, delivery_instructions,
    shipping_cost, stripe_session_id
  ) values (
    p_reseller_id, p_profile_id, p_delivery_type, p_parcel_point, p_instructions,
    coalesce(p_shipping_cost, 0), p_stripe_session_id
  )
  returning id into v_shipment_id;

  update public.order_items
  set fulfillment_status = 'delivery_requested', delivery_requested_at = now(), shipment_id = v_shipment_id
  where id = any(v_eligible_ids);

  return jsonb_build_object('shipment_id', v_shipment_id, 'already_processed', false, 'item_count', array_length(v_eligible_ids, 1));
end;
$$;

revoke all on function public.finalize_b2b_delivery_request(uuid[], uuid, uuid, text, jsonb, text, numeric, text) from public, anon, authenticated;
grant execute on function public.finalize_b2b_delivery_request(uuid[], uuid, uuid, text, jsonb, text, numeric, text) to service_role;

notify pgrst, 'reload schema';
