-- ============================================================================
-- Corrige deux bugs découverts en testant sendcloud-sync-tracking sur un
-- colis réellement livré (Mondial Relay #70753239, "Colis livré au
-- destinataire" confirmé côté Mondial Relay, mais resté bloqué sur
-- "En préparation" côté admin) :
--
--   1. sendcloud-sync-tracking lisait status_code/status_description à la
--      racine de la réponse GET /parcels/tracking/{tracking_number} — ces
--      champs n'existent qu'À L'INTÉRIEUR de chaque élément du tableau
--      `events[]` (confirmé sur l'exemple JSON officiel de
--      sendcloud.dev/api/v3/parcel-tracking). La classification renvoyait
--      donc toujours null, silencieusement : aucune erreur, mais aucune
--      mise à jour non plus. Corrigé côté edge function (voir le fichier),
--      rien à changer ici pour ce point.
--
--   2. La documentation Sendcloud confirme que le payload du webhook
--      parcel_status_changed a la MÊME forme que cette réponse de tracking
--      — qui n'expose PAS d'id de colis fiable à la racine, seulement
--      tracking_numbers[].tracking_number. apply_sendcloud_parcel_status ne
--      pouvait donc pas être appelée depuis le webhook (aucun
--      sendcloud_parcel_id disponible dans le payload). Ce fichier ajoute
--      un second identifiant de correspondance, p_tracking_number, en plus
--      de p_sendcloud_parcel_id — l'appelant fournit l'un ou l'autre.
-- ============================================================================

-- CREATE OR REPLACE n'écrase une fonction que si la liste de TYPES de
-- paramètres est identique — ajouter p_tracking_number change cette liste
-- (4 -> 5 types), donc sans ce DROP explicite, l'ancienne version à 4
-- paramètres resterait en base EN PLUS de la nouvelle (une vraie surcharge
-- distincte, pas un remplacement), avec son ancien corps qui ne sait pas
-- chercher par tracking_number — une source de confusion/bug silencieux si
-- jamais un appelant venait encore à cibler exactement 4 arguments.
drop function if exists public.apply_sendcloud_parcel_status(text, text, text, text);

create or replace function public.apply_sendcloud_parcel_status(
  p_sendcloud_parcel_id text,
  p_new_status text,
  p_carrier_status_code text default null,
  p_carrier_status_message text default null,
  p_tracking_number text default null
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
  if p_sendcloud_parcel_id is null and p_tracking_number is null then
    raise exception 'p_sendcloud_parcel_id ou p_tracking_number est requis';
  end if;

  if p_new_status is not null and p_new_status not in ('label_created', 'shipped', 'delivered') then
    raise exception 'Statut invalide : %', p_new_status;
  end if;

  select id, shipment_id, status into v_parcel
  from public.shipment_parcels
  where (p_sendcloud_parcel_id is not null and sendcloud_parcel_id = p_sendcloud_parcel_id)
     or (p_tracking_number is not null and tracking_number = p_tracking_number)
  for update;

  if v_parcel.id is null then
    return jsonb_build_object('found', false);
  end if;

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

revoke all on function public.apply_sendcloud_parcel_status(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.apply_sendcloud_parcel_status(text, text, text, text, text) to service_role;

notify pgrst, 'reload schema';
