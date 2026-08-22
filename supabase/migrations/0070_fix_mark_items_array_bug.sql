-- ============================================================================
-- Corrige un bug réel confirmé en direct (curl) : `update ... returning id
-- into v_ids` où v_ids est déclaré uuid[] échoue avec
-- "malformed array literal" dès qu'au moins une ligne correspond — Postgres
-- tente de parser le uuid scalaire renvoyé comme un littéral de tableau.
-- admin_mark_items_received et admin_mark_items_ready_to_ship (0063)
-- échouaient donc systématiquement dès qu'un article correspondait,
-- silencieusement avalé côté UI (ReceptionView ne vérifiait pas le retour).
-- Corrigé avec le même motif CTE + array_agg déjà utilisé correctement dans
-- confirm_b2b_payment / finalize_b2b_delivery_request.
-- ============================================================================

create or replace function public.admin_mark_items_received(p_item_ids uuid[])
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
    set fulfillment_status = 'received', received_at = now()
    from public.orders o
    where oi.order_id = o.id
      and oi.id = any(p_item_ids)
      and oi.fulfillment_status = 'ordered'
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

create or replace function public.admin_mark_items_ready_to_ship(p_item_ids uuid[])
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
    set fulfillment_status = 'ready_to_ship', ready_to_ship_at = now()
    from public.orders o
    where oi.order_id = o.id
      and oi.id = any(p_item_ids)
      and oi.fulfillment_status = 'received'
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

grant execute on function public.admin_mark_items_received(uuid[]) to authenticated;
grant execute on function public.admin_mark_items_ready_to_ship(uuid[]) to authenticated;

notify pgrst, 'reload schema';
