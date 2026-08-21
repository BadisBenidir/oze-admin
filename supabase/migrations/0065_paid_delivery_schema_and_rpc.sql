-- ============================================================================
-- Livraison payante par le revendeur (carte uniquement) : la demande de
-- livraison n'est plus gratuite/instantanée. reseller_request_item_delivery
-- (RPC appelable directement par un revendeur authentifié, SANS paiement)
-- est donc retirée — sinon n'importe qui pourrait contourner le paiement en
-- l'appelant directement depuis la console du navigateur. Elle est remplacée
-- par finalize_b2b_delivery_request, appelée UNIQUEMENT par
-- b2b-stripe-webhook (rôle service_role) une fois le paiement Stripe
-- confirmé — jamais par un revendeur directement.
-- ============================================================================

drop function if exists public.reseller_request_item_delivery(uuid[], text, jsonb, text);

-- 1 pt = petit accessoire/portefeuille, 3 pts = sac (barème de tarification
-- des colis). Champ manuel : les catégories sont du texte libre géré par les
-- admins (pas d'énumération fixe), donc pas de dérivation fiable possible.
alter table public.products add column if not exists shipping_points int not null default 1 check (shipping_points > 0);

alter table public.shipments add column if not exists shipping_cost numeric not null default 0;
alter table public.shipments add column if not exists stripe_session_id text unique;

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
  -- Idempotence : le webhook Stripe peut être livré plusieurs fois pour le
  -- même événement — un second appel sur la même session ne recrée rien.
  select id into v_existing_shipment_id from public.shipments where stripe_session_id = p_stripe_session_id;
  if v_existing_shipment_id is not null then
    return jsonb_build_object('shipment_id', v_existing_shipment_id, 'already_processed', true);
  end if;

  if p_delivery_type not in ('domicile', 'point_relais') then
    raise exception 'Mode de livraison invalide';
  end if;

  -- Revalidation défensive (même après paiement confirmé) : les articles
  -- doivent toujours être ready_to_ship et appartenir bien à ce revendeur.
  select array_agg(oi.id) into v_eligible_ids
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where oi.id = any(p_item_ids)
    and oi.fulfillment_status = 'ready_to_ship'
    and oi.status = 'active'
    and o.order_channel = 'b2b'
    and o.reseller_id = p_reseller_id
  for update of oi;

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

-- Jamais accordée à `authenticated` : cette fonction fait confiance à ses
-- paramètres (reseller_id, shipping_cost...) sans les redériver d'auth.uid(),
-- donc seul le rôle service_role (le webhook Stripe) peut l'appeler.
revoke all on function public.finalize_b2b_delivery_request(uuid[], uuid, uuid, text, jsonb, text, numeric, text) from public, authenticated;
grant execute on function public.finalize_b2b_delivery_request(uuid[], uuid, uuid, text, jsonb, text, numeric, text) to service_role;

notify pgrst, 'reload schema';
