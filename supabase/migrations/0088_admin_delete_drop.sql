-- ============================================================================
-- Suppression d'un drop B2B de test.
--
-- Rappel du schéma réel (0031_b2b_drops.sql) : products.product_ids est un
-- simple uuid[] stocké SUR la ligne drops elle-même — il n'existe ni colonne
-- products.b2b_drop_id, ni table de liaison drop_items. Aucune autre table
-- ne référence drops.id (vérifié : aucune "references public.drops" dans
-- tout le schéma). Supprimer une ligne drops n'a donc AUCUN effet cascade
-- sur products/orders — pas de FK à nettoyer, pas de "détachement" à faire :
-- le produit reste exactement dans le statut où il était (draft si le drop
-- n'a jamais été exécuté, for-sale-b2b/sold-b2b sinon), product_ids n'étant
-- qu'un manifeste du lot, jamais une contrainte d'intégrité.
--
-- Seul risque réel : perdre la traçabilité d'un lot dont des articles ont
-- déjà été VENDUS (product.status = 'sold-b2b') — admin_delete_drop bloque
-- ce cas précis plutôt que de deviner un lien commande/paiement qui n'existe
-- pas dans ce schéma (order_items ne référence jamais drops.id non plus).
-- ============================================================================

create or replace function public.admin_delete_drop(p_drop_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_drop record;
  v_sold_count integer;
begin
  if not public.is_admin() then
    raise exception 'Accès refusé';
  end if;

  select id, title, product_ids into v_drop from public.drops where id = p_drop_id;
  if v_drop.id is null then
    raise exception 'Drop introuvable';
  end if;

  select count(*) into v_sold_count
  from public.products
  where id = any(v_drop.product_ids) and status like 'sold-%';

  if v_sold_count > 0 then
    raise exception 'Impossible de supprimer ce drop : % article(s) déjà vendu(s) parmi ses produits — l''historique doit être conservé. Retirez-les du drop (fusion/déplacement) avant de le supprimer si besoin.', v_sold_count;
  end if;

  delete from public.drops where id = p_drop_id;

  return jsonb_build_object('deleted', true, 'drop_id', p_drop_id, 'title', v_drop.title);
end;
$$;

grant execute on function public.admin_delete_drop(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- RLS : la policy existante drops_admin_all ("for all", donc DELETE inclus)
-- permettrait à un admin de supprimer une ligne drops directement depuis le
-- client, en contournant le garde-fou "articles déjà vendus" ci-dessus. On la
-- restreint à SELECT/INSERT/UPDATE et on retire le DELETE direct : la seule
-- suppression possible passe désormais par admin_delete_drop (SECURITY
-- DEFINER, contourne RLS en interne après avoir validé la règle métier).
-- ----------------------------------------------------------------------------
drop policy if exists drops_admin_all on public.drops;

create policy drops_admin_select on public.drops
  for select using (public.is_admin());
create policy drops_admin_insert on public.drops
  for insert with check (public.is_admin());
create policy drops_admin_update on public.drops
  for update using (public.is_admin()) with check (public.is_admin());

revoke delete on public.drops from authenticated, anon;

notify pgrst, 'reload schema';
