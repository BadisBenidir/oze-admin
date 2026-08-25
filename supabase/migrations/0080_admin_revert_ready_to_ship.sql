-- ============================================================================
-- Permet à un admin de remettre en attente un article marqué par erreur
-- "prêt à être livré" (ready_to_ship) — il redevient 'received', disparaît
-- de "Prêts à être expédiés" côté revendeur (plus sélectionnable pour une
-- demande de livraison) et réapparaît dans la colonne "Reçus" de la Vue
-- Réception admin.
--
-- Sécurité : la clause `fulfillment_status = 'ready_to_ship'` dans le WHERE
-- suffit à bloquer l'action dès que le revendeur a entre-temps formulé sa
-- demande de livraison (passage à 'delivery_requested' puis 'shipped') — ces
-- lignes ne correspondent simplement plus au filtre et sont silencieusement
-- exclues de v_updated_ids, jamais annulées après coup. Même motif CTE +
-- array_agg que admin_mark_items_received/admin_mark_items_ready_to_ship
-- (0070) pour éviter le bug "malformed array literal" déjà rencontré.
-- ============================================================================

create or replace function public.admin_revert_item_to_received(p_item_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated_ids uuid[];
begin
  if not public.is_admin() then
    raise exception 'Accès refusé';
  end if;

  with updated as (
    update public.order_items oi
    set fulfillment_status = 'received', ready_to_ship_at = null
    from public.orders o
    where oi.order_id = o.id
      and oi.id = any(p_item_ids)
      and oi.fulfillment_status = 'ready_to_ship'
      and oi.status = 'active'
      and o.order_channel = 'b2b'
    returning oi.id
  )
  select array_agg(id) into v_updated_ids from updated;

  return jsonb_build_object(
    'updated_ids', to_jsonb(coalesce(v_updated_ids, array[]::uuid[])),
    'updated_count', coalesce(array_length(v_updated_ids, 1), 0)
  );
end;
$$;

grant execute on function public.admin_revert_item_to_received(uuid[]) to authenticated;

notify pgrst, 'reload schema';
