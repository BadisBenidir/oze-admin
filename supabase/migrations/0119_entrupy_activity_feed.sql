-- ============================================================================
-- Trace l'ajout POST-ACHAT d'un certificat Entrupy avec un horodatage dédié,
-- pour qu'il apparaisse dans le fil "Activité Récente" du Dashboard admin
-- (orderService.getRecentActivity) — jusqu'ici seuls commandes, nouveaux
-- clients, recharges de portefeuille et annulations y figuraient.
-- ============================================================================

alter table public.order_items
  add column if not exists entrupy_requested_at timestamptz;

comment on column public.order_items.entrupy_requested_at is
  'Horodatage de la demande de certificat Entrupy POST-ACHAT (finalize_entrupy_certificate_request) — null si le certificat a été choisi dès le panier (entrupy_requested posé à la création de la commande, voir 0083).';

create or replace function public.finalize_entrupy_certificate_request(
  p_item_ids uuid[],
  p_reseller_id uuid,
  p_stripe_session_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_already_id uuid;
  v_eligible_ids uuid[];
  v_price constant numeric := 19.99;
begin
  select id into v_already_id from public.order_items where entrupy_stripe_session_id = p_stripe_session_id limit 1;
  if v_already_id is not null then
    return jsonb_build_object('already_processed', true, 'item_count', 0);
  end if;

  perform 1
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where oi.id = any(p_item_ids)
    and oi.status = 'active'
    and oi.entrupy_requested = false
    and oi.fulfillment_status not in ('delivery_requested', 'shipped')
    and o.order_channel = 'b2b'
    and o.reseller_id = p_reseller_id
  for update of oi;

  select array_agg(oi.id) into v_eligible_ids
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where oi.id = any(p_item_ids)
    and oi.status = 'active'
    and oi.entrupy_requested = false
    and oi.fulfillment_status not in ('delivery_requested', 'shipped')
    and o.order_channel = 'b2b'
    and o.reseller_id = p_reseller_id;

  if v_eligible_ids is null or array_length(v_eligible_ids, 1) <> array_length(p_item_ids, 1) then
    raise exception 'Certains articles ne sont plus éligibles pour un ajout de certificat Entrupy';
  end if;

  update public.order_items
  set entrupy_requested = true,
      entrupy_requested_at = now(),
      entrupy_cost = v_price,
      entrupy_stripe_session_id = p_stripe_session_id
  where id = any(v_eligible_ids);

  update public.orders o
  set entrupy_cost = o.entrupy_cost + added.amount,
      total_amount = o.total_amount + added.amount
  from (
    select order_id, count(*) * v_price as amount
    from public.order_items
    where id = any(v_eligible_ids)
    group by order_id
  ) added
  where o.id = added.order_id;

  return jsonb_build_object('already_processed', false, 'item_count', array_length(v_eligible_ids, 1));
end;
$$;

revoke all on function public.finalize_entrupy_certificate_request(uuid[], uuid, text) from public, anon, authenticated;
grant execute on function public.finalize_entrupy_certificate_request(uuid[], uuid, text) to service_role;

notify pgrst, 'reload schema';
