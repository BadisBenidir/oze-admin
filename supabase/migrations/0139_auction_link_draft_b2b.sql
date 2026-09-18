-- ============================================================================
-- "Ajouter une pièce" (AuctionItemFormModal, Enchères B2B) doit aussi
-- proposer les articles 'draft-b2b' (0130, créés directement depuis Produits
-- B2B), pas seulement les brouillons classiques — déjà corrigé côté client.
--
-- Mais admin_generate_order_from_auction_item (0105/0137) refusait encore
-- de générer la commande d'un lot adjugé si sa fiche produit liée n'était
-- pas EXACTEMENT 'draft' : un lot lié à un article 'draft-b2b' aurait donc
-- échoué systématiquement à l'adjudication ("Ce produit n'est plus
-- disponible") malgré le lien tout à fait valide côté client.
-- ============================================================================

create or replace function public.admin_generate_order_from_auction_item(p_item_id uuid)
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
  if not public.is_admin() then
    raise exception 'Accès refusé';
  end if;

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
  if v_product.status not in ('draft', 'draft-b2b') then
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

notify pgrst, 'reload schema';
