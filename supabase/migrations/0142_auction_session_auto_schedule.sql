-- ============================================================================
-- Ouverture et clôture AUTOMATIQUES d'une session d'enchères à l'heure
-- programmée (starts_at / ends_at) — jusqu'ici entièrement manuel (boutons
-- "Lancer en direct" / "Clôturer", AuctionsAdmin.tsx). pg_cron, exécuté
-- chaque minute, même schéma que execute_due_drops (0031).
--
-- Piège identique à celui déjà rencontré sur cancel-entrupy-certificate
-- (0141) : admin_close_auction_session / admin_generate_order_from_auction_
-- item vérifient toutes les deux is_admin(), qui repose sur auth.uid() —
-- TOUJOURS null dans le contexte d'un job cron (aucune session utilisateur).
-- Un appel direct de ces fonctions depuis le cron échouerait donc
-- systématiquement avec "Accès refusé". Solution : extrait la logique métier
-- dans des fonctions "_core" sans contrôle d'autorisation (jamais
-- exécutables directement par un client, revoke public/authenticated) ; les
-- fonctions admin_* deviennent de simples enveloppes qui vérifient
-- is_admin() puis délèguent au core — comportement strictement inchangé
-- pour les boutons existants côté admin.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- generate_order_from_auction_item_core : logique de 0139, sans le contrôle
-- is_admin().
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

revoke all on function public.generate_order_from_auction_item_core(uuid) from public, authenticated;

create or replace function public.admin_generate_order_from_auction_item(p_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Accès refusé';
  end if;
  return public.generate_order_from_auction_item_core(p_item_id);
end;
$$;

grant execute on function public.admin_generate_order_from_auction_item(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- close_auction_session_core : logique de 0137, sans le contrôle is_admin().
-- ----------------------------------------------------------------------------
create or replace function public.close_auction_session_core(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item_id uuid;
  v_orders_created int := 0;
  v_orders_failed int := 0;
begin
  update public.auction_items
  set
    status = case
      when current_winner_id is not null and (reserve_price is null or current_price >= reserve_price) then 'sold'
      else 'unsold'
    end,
    payment_deadline = case
      when current_winner_id is not null and (reserve_price is null or current_price >= reserve_price) then now() + interval '24 hours'
      else payment_deadline
    end
  where session_id = p_session_id and status = 'active';

  for v_item_id in
    select id from public.auction_items
    where session_id = p_session_id and status = 'sold' and order_id is null
  loop
    begin
      perform public.generate_order_from_auction_item_core(v_item_id);
      v_orders_created := v_orders_created + 1;
    exception when others then
      v_orders_failed := v_orders_failed + 1;
    end;
  end loop;

  update public.auction_sessions set status = 'closed' where id = p_session_id;

  return jsonb_build_object('session_id', p_session_id, 'orders_created', v_orders_created, 'orders_failed', v_orders_failed);
end;
$$;

revoke all on function public.close_auction_session_core(uuid) from public, authenticated;

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
  return public.close_auction_session_core(p_session_id);
end;
$$;

grant execute on function public.admin_close_auction_session(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- execute_due_auction_sessions : exécutée chaque minute par pg_cron. Fait
-- passer 'upcoming' -> 'live' dès starts_at atteint, puis clôture (classe
-- les lots + génère les commandes, via close_auction_session_core) chaque
-- session 'live' dont ends_at est dépassé.
-- ----------------------------------------------------------------------------
create or replace function public.execute_due_auction_sessions()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  due_session record;
begin
  update public.auction_sessions
  set status = 'live'
  where status = 'upcoming' and starts_at <= now();

  for due_session in
    select id from public.auction_sessions
    where status = 'live' and ends_at <= now()
  loop
    perform public.close_auction_session_core(due_session.id);
  end loop;
end;
$$;

revoke all on function public.execute_due_auction_sessions() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'execute-due-auction-sessions') then
    perform cron.unschedule('execute-due-auction-sessions');
  end if;
exception when others then
  null; -- pg_cron pas encore disponible : rien a desinscrire.
end $$;

do $$
begin
  perform cron.schedule('execute-due-auction-sessions', '* * * * *', 'select public.execute_due_auction_sessions()');
exception when others then
  raise notice 'Impossible de programmer execute-due-auction-sessions via pg_cron automatiquement - a faire manuellement une fois pg_cron active, via cron.schedule().';
end $$;

notify pgrst, 'reload schema';
