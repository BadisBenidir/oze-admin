-- ============================================================================
-- Réception enregistrée au plus tard à la création du bordereau.
--
-- Les pièces de sourcing passent directement « Livraison demandée » à la
-- clôture de la mission (admin_create_sourcing_delivery_request, 0205) : elles
-- ne passent jamais par « Vue Réception » et restaient « Pas encore reçu »
-- même une fois expédiées ou livrées. Un bordereau n'est créé que pour une
-- pièce physiquement dans nos locaux : si la réception n'a pas été
-- enregistrée, on la date au moment du bordereau (ou de l'expédition).
-- ============================================================================

create or replace function public.order_item_received_on_label()
returns trigger
language plpgsql
as $$
begin
  if new.received_at is null
     and new.fulfillment_status in ('label_created', 'shipped', 'delivered')
     and (tg_op = 'INSERT' or old.fulfillment_status is distinct from new.fulfillment_status) then
    new.received_at := coalesce(new.label_created_at, new.shipped_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists order_item_received_on_label on public.order_items;
create trigger order_item_received_on_label
  before insert or update of fulfillment_status on public.order_items
  for each row execute function public.order_item_received_on_label();
