-- Article reçu à l'atelier AVANT d'être vendu (en enchère, en drop, en vente B2B…).
-- products.received_at : posé depuis la fiche produit. À la vente, la ligne de
-- commande B2B naît directement « prête à être livrée » au lieu de « à réceptionner ».

alter table public.products add column if not exists received_at timestamptz;

create or replace function public.order_items_inherit_product_received()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_received timestamptz;
begin
  if coalesce(new.fulfillment_status, 'ordered') <> 'ordered' or new.product_id is null then
    return new;
  end if;
  select p.received_at into v_received from public.products p where p.id = new.product_id;
  if v_received is null then
    return new;
  end if;
  if exists (select 1 from public.orders o where o.id = new.order_id and o.order_channel = 'b2b') then
    new.fulfillment_status := 'ready_to_ship';
    new.received_at := coalesce(new.received_at, v_received);
    new.ready_to_ship_at := coalesce(new.ready_to_ship_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists order_items_inherit_product_received on public.order_items;
create trigger order_items_inherit_product_received
  before insert on public.order_items
  for each row execute function public.order_items_inherit_product_received();

-- Marquer / démarquer un article comme reçu. S'il est déjà vendu (ligne B2B
-- active encore « à réceptionner » ou « reçu »), elle passe prête à être livrée.
create or replace function public.admin_set_product_received(p_product_id uuid, p_received boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
begin
  if not public.is_admin() then
    raise exception 'Accès refusé';
  end if;

  update public.products
  set received_at = case when p_received then coalesce(received_at, now()) else null end
  where id = p_product_id;

  if p_received then
    update public.order_items oi
    set fulfillment_status = 'ready_to_ship',
        received_at = coalesce(oi.received_at, now()),
        ready_to_ship_at = now()
    from public.orders o
    where oi.order_id = o.id
      and oi.product_id = p_product_id
      and oi.status = 'active'
      and oi.fulfillment_status in ('ordered', 'received')
      and o.order_channel = 'b2b';
    get diagnostics v_count = row_count;
  end if;

  return jsonb_build_object('updated_items', v_count);
end;
$$;

grant execute on function public.admin_set_product_received(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
