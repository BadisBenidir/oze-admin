-- ============================================================================
-- Module B2B Revendeurs — 2/4 : Row Level Security
-- Dépend de public.is_admin() / public.current_reseller_id() (voir 0001).
-- N'exécute que des ADD (aucune policy existante n'est touchée sur
-- orders/order_items/products) sauf mention contraire explicite ci-dessous.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- resellers
-- ----------------------------------------------------------------------------
alter table public.resellers enable row level security;

drop policy if exists resellers_admin_all on public.resellers;
create policy resellers_admin_all on public.resellers
  for all
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists resellers_reseller_select_own on public.resellers;
create policy resellers_reseller_select_own on public.resellers
  for select
  using (id = public.current_reseller_id());

-- ----------------------------------------------------------------------------
-- reseller_contacts
-- ----------------------------------------------------------------------------
alter table public.reseller_contacts enable row level security;

drop policy if exists reseller_contacts_admin_all on public.reseller_contacts;
create policy reseller_contacts_admin_all on public.reseller_contacts
  for all
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists reseller_contacts_reseller_select_own on public.reseller_contacts;
create policy reseller_contacts_reseller_select_own on public.reseller_contacts
  for select
  using (reseller_id = public.current_reseller_id());

-- ----------------------------------------------------------------------------
-- orders / order_items — ajout d'une policy SELECT scopée au revendeur.
-- Aucune policy INSERT/UPDATE n'est ajoutée pour le rôle revendeur : toute
-- création/validation de commande B2B passe par les RPC SECURITY DEFINER du
-- fichier 0004 (submit_b2b_order / approve_b2b_order / reject_b2b_order),
-- jamais par une écriture directe côté client.
-- ----------------------------------------------------------------------------
drop policy if exists orders_reseller_select_own on public.orders;
create policy orders_reseller_select_own on public.orders
  for select
  using (reseller_id = public.current_reseller_id());

drop policy if exists order_items_reseller_select_own on public.order_items;
create policy order_items_reseller_select_own on public.order_items
  for select
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id
        and o.reseller_id = public.current_reseller_id()
    )
  );

-- ----------------------------------------------------------------------------
-- products — ⚠️ AUDIT MANUEL REQUIS, aucune policy n'est créée ici.
--
-- On ne peut pas, depuis ce dépôt, lister les policies déjà en place sur
-- `products` (utilisées par le site public / l'admin). L'accès catalogue des
-- revendeurs passe exclusivement par la vue `public.b2b_catalog` (0003), qui
-- contourne le RLS de `products` car elle est possédée par le rôle `postgres`.
--
-- MAIS : si une policy existante sur `products` autorise déjà `authenticated`
-- (ou `anon`) à lire toutes les colonnes via `USING (true)` ou équivalent,
-- un compte revendeur authentifié pourrait alors interroger `products`
-- directement (via l'API PostgREST) et voir purchase_price/internal_comments/
-- serial_number malgré la vue restreinte. Avant mise en prod, vérifiez dans
-- Supabase Dashboard → Authentication → Policies → products qu'aucune policy
-- SELECT permissive n'expose ces colonnes à un rôle autre que `admin`. Si
-- c'est le cas, il faudra soit restreindre cette policy (ex: ajouter
-- `and not public_current_reseller_id() is not null` ou équivalent), soit la
-- remplacer par une policy explicite `using (public.is_admin())` combinée à
-- une policy séparée pour le rôle `anon`/site public.
-- ----------------------------------------------------------------------------
