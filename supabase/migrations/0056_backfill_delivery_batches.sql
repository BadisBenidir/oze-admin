-- ============================================================================
-- Rattache les commandes B2B existantes, non annulées/livrées/expédiées, à un
-- lot 'open' par revendeur — pour qu'elles apparaissent dans le regroupement
-- dès la mise en ligne de la fonctionnalité (voir 0054_delivery_batches.sql),
-- au lieu de rester orphelines (batch_id null) jusqu'à la prochaine commande.
-- ============================================================================

do $$
declare
  r record;
  v_batch_id uuid;
begin
  for r in
    select distinct reseller_id
    from public.orders
    where order_channel = 'b2b'
      and batch_id is null
      and status not in ('shipped', 'delivered', 'cancelled')
  loop
    v_batch_id := public.get_or_create_open_batch(r.reseller_id);
    update public.orders
    set batch_id = v_batch_id
    where reseller_id = r.reseller_id
      and order_channel = 'b2b'
      and batch_id is null
      and status not in ('shipped', 'delivered', 'cancelled');
  end loop;
end $$;
