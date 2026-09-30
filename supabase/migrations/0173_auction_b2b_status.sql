-- ============================================================================
-- Nouveau statut produit `auction-b2b` (« Enchère ») : un article lié à un
-- lot d'enchère en cours ou adjugé (pas encore commandé) est distinguable
-- d'un simple brouillon dans « Gestion des Produits ». Même patron que
-- 'drop-b2b' (0135) :
--   - lien à un lot 'active'/'sold'      → 'auction-b2b' (depuis draft/draft-b2b) ;
--   - lot non vendu, supprimé, ou fiche  → retour 'draft-b2b' (référence B2B)
--     produit détachée/remplacée            ou 'draft' ;
--   - commande générée (adjudication)    → 'sold-b2b' (inchangé, 0142) ;
--   - lot annulé                         → statut choisi à l'annulation (0156).
-- Bénéfice secondaire : un article 'auction-b2b' sort naturellement des
-- sélecteurs qui ne listent que draft/draft-b2b (drops, sourcing, enchères).
-- ============================================================================

alter table public.products drop constraint if exists products_status_check;
alter table public.products
  add constraint products_status_check check (status in (
    'draft', 'draft-b2b', 'sourced-b2b', 'drop-b2b', 'auction-b2b', 'for-sale-online', 'for-sale-other-platform', 'sold-online',
    'sold-other-platform', 'sold-display', 'for-auction-live', 'sold-auction',
    'for-sale-b2b', 'reserved-b2b', 'sold-b2b', 'archived',
    'cadeau', 'cadeau-attribue', 'cadeau-livre'
  ));

-- ----------------------------------------------------------------------------
-- sync_auction_product_status : suit le cycle de vie des lots.
-- ----------------------------------------------------------------------------
create or replace function public.sync_auction_product_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Ancienne fiche libérée : lot supprimé, fiche remplacée/détachée, ou lot
  -- sorti des statuts engagés (non vendu). Un lot annulé fixe lui-même le
  -- statut du produit (0156) : le produit n'est alors plus 'auction-b2b'.
  if tg_op in ('UPDATE', 'DELETE') and old.product_id is not null
     and (tg_op = 'DELETE'
          or new.product_id is distinct from old.product_id
          or new.status not in ('active', 'sold')) then
    update public.products
    set status = case when b2b_reference is not null then 'draft-b2b' else 'draft' end
    where id = old.product_id and status = 'auction-b2b';
  end if;

  if tg_op in ('INSERT', 'UPDATE') and new.product_id is not null and new.status in ('active', 'sold') then
    update public.products
    set status = 'auction-b2b'
    where id = new.product_id and status in ('draft', 'draft-b2b');
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists auction_items_sync_product_status on public.auction_items;
create trigger auction_items_sync_product_status
after insert or update of product_id, status or delete on public.auction_items
for each row execute function public.sync_auction_product_status();

-- ----------------------------------------------------------------------------
-- generate_order_from_auction_item_core (0142) : accepte aussi une fiche 'auction-b2b'.
-- ----------------------------------------------------------------------------
create or replace function public.generate_order_from_auction_item_core(p_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item record;
  v_product record;
  v_reseller_id uuid;
  v_email text;
  v_order_id uuid;
  v_order_number text;
begin
  select * into v_item from public.auction_items where id = p_item_id for update;
  if v_item is null then
    raise exception 'Lot introuvable';
  end if;
  if v_item.status <> 'sold' then
    raise exception 'Ce lot n''a pas été adjugé';
  end if;
  if v_item.current_winner_id is null then
    raise exception 'Aucun gagnant pour ce lot';
  end if;
  if v_item.product_id is null then
    raise exception 'Cette pièce n''est liée à aucune fiche produit — liez-en une avant de générer la commande';
  end if;

  select * into v_product from public.products where id = v_item.product_id for update;
  if v_product is null then
    raise exception 'Fiche produit introuvable';
  end if;
  if v_product.status not in ('draft', 'draft-b2b', 'auction-b2b') then
    raise exception 'Ce produit n''est plus disponible (déjà vendu ailleurs)';
  end if;

  select rc.reseller_id into v_reseller_id from public.reseller_contacts rc where rc.profile_id = v_item.current_winner_id limit 1;
  if v_reseller_id is null then
    raise exception 'Revendeur introuvable pour ce gagnant';
  end if;
  select email into v_email from public.profiles where id = v_item.current_winner_id;

  v_order_number := 'AUC-' || to_char(now(), 'YYYYMMDDHH24MISS') || '-' || substr(v_item.id::text, 1, 4);

  insert into public.orders (
    order_number, email, status, total_amount, subtotal, shipping_cost, currency,
    payment_status, reseller_id, placed_by_profile_id,
    order_channel, approval_status, approved_at
  ) values (
    v_order_number, v_email, 'confirmed', v_item.current_price, v_item.current_price, 0, 'EUR',
    'pending', v_reseller_id, v_item.current_winner_id,
    'b2b', 'approved', now()
  )
  returning id into v_order_id;

  insert into public.order_items (order_id, product_id, quantity, unit_price, line_total, product_snapshot)
  values (v_order_id, v_product.id, 1, v_item.current_price, v_item.current_price, to_jsonb(v_product));

  update public.products
  set status = 'sold-b2b', reserved_by_reseller_id = v_reseller_id, reserved_by_order_id = v_order_id, reserved_at = now()
  where id = v_product.id;

  update public.auction_items set order_id = v_order_id where id = p_item_id;

  return jsonb_build_object('order_id', v_order_id, 'order_number', v_order_number);
end;
$$;

revoke all on function public.generate_order_from_auction_item_core(uuid) from public, authenticated;

-- ----------------------------------------------------------------------------
-- Backfill : fiches déjà liées à un lot en cours ou adjugé sans commande.
-- ----------------------------------------------------------------------------
update public.products p
set status = 'auction-b2b'
where p.status in ('draft', 'draft-b2b')
  and exists (
    select 1 from public.auction_items ai
    where ai.product_id = p.id and ai.status in ('active', 'sold') and ai.order_id is null
  );

notify pgrst, 'reload schema';
