-- ============================================================================
-- Gestion admin des enchères (Sessions & Lots / Accès / Résultats) —
-- complète 0104_auction_system.sql, déjà entièrement gérée en écriture par
-- les admins via la policy `for all using (is_admin())` sur les 4 tables :
-- aucune nouvelle table ni policy n'est nécessaire pour le CRUD basique
-- (créer une session, ajouter un lot, offrir un accès, forcer live/closed).
--
-- Ce qui manque réellement :
--   1. auction_items.product_id — un lot d'enchère n'est pas obligatoirement
--      une fiche produit existante (voir auction_items.title/brand/grade en
--      texte libre, 0104) ; pour transformer un lot adjugé en vraie
--      commande, il faut pouvoir le rattacher à un produit réel. Nullable :
--      un lot peut très bien ne représenter aucune fiche produit tant qu'il
--      n'est pas vendu (voir garde dans admin_generate_order_from_auction_item).
--   2. admin_close_auction_session — classe chaque lot encore actif en
--      'sold' (réserve atteinte ou absente + un gagnant) ou 'unsold' au
--      moment de la clôture, plutôt que de ne dériver ce statut qu'à
--      l'affichage (jamais persisté sinon, ambigu pour "Générer la commande").
--   3. admin_generate_order_from_auction_item — même schéma qu'
--      admin_record_direct_b2b_sale (0066) : crée une vraie commande B2B
--      (orders/order_items) pour le gagnant, bascule le produit en
--      'sold-b2b'. Bloque si le lot n'a pas de product_id (même raison que
--      pour le sourcing sur mesure, 0098 : ce repo ne crée jamais lui-même
--      de marque/catégorie pour un produit inventé à la volée).
-- ============================================================================

alter table public.auction_items
  add column if not exists product_id uuid references public.products (id) on delete set null;

create index if not exists auction_items_product_id_idx on public.auction_items (product_id);

-- ----------------------------------------------------------------------------
-- Clôture d'une session : classe chaque lot encore actif, puis clôt la
-- session elle-même.
-- ----------------------------------------------------------------------------
create or replace function public.admin_close_auction_session(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Accès refusé';
  end if;

  update public.auction_items
  set status = case
    when current_winner_id is not null and (reserve_price is null or current_price >= reserve_price) then 'sold'
    else 'unsold'
  end
  where session_id = p_session_id and status = 'active';

  update public.auction_sessions set status = 'closed' where id = p_session_id;

  return jsonb_build_object('session_id', p_session_id);
end;
$$;

grant execute on function public.admin_close_auction_session(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Génère la commande B2B réelle d'un lot adjugé — même schéma que
-- admin_record_direct_b2b_sale (0066), reseller/placed_by résolus depuis le
-- gagnant (reseller_contacts.profile_id).
-- ----------------------------------------------------------------------------
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
  if v_product.status <> 'draft' then
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

  return jsonb_build_object('order_id', v_order_id, 'order_number', v_order_number);
end;
$$;

grant execute on function public.admin_generate_order_from_auction_item(uuid) to authenticated;

notify pgrst, 'reload schema';
