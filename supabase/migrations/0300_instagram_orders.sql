-- ============================================================================
-- Ventes Instagram (B2C) : l'admin crée un lien de commande pour un client,
-- le client remplit sa livraison, paie par virement, récupère sa facture et
-- suit son colis sur CE lien (page publique sans compte).
--
-- La commande est une vraie ligne orders (order_channel = 'web' → comptée
-- dans le CA B2C, le journal des ventes, la TVA) marquée sales_source =
-- 'instagram'. Le lien et son suivi vivent dans instagram_order_links.
--
-- Produits : réservés dès la création du lien (statut 'reserved-online', hors
-- catalogue B2B / drops / enchères), vendus ('sold-online') au paiement,
-- remis dans leur statut précédent si le lien expire sans paiement.
-- ============================================================================

-- 1. Statut produit « réservé (vente en ligne) ».
alter table public.products drop constraint if exists products_status_check;
alter table public.products add constraint products_status_check check (
  status::text = any (array[
    'draft', 'draft-b2b', 'sourced-b2b', 'drop-b2b', 'auction-b2b', 'for-sale-online', 'for-sale-other-platform',
    'sold-online', 'sold-other-platform', 'sold-display', 'for-auction-live', 'sold-auction', 'for-sale-b2b',
    'instant-b2b', 'archived-instant-b2b', 'reserved-b2b', 'sold-b2b', 'archived', 'cadeau', 'cadeau-attribue',
    'cadeau-livre', 'reserved-online'
  ])
);

-- 2. Origine commerciale d'une commande web.
alter table public.orders add column if not exists sales_source text;
create index if not exists orders_sales_source_idx on public.orders (sales_source) where sales_source is not null;

-- 3. Jeton aléatoire (144 bits, base64url, 24 caractères) : impossible à deviner.
create or replace function public.random_url_token()
returns text
language sql
volatile
set search_path = public, extensions
as $$
  select translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/=', '-_');
$$;
revoke all on function public.random_url_token() from public, anon, authenticated;

create sequence if not exists public.instagram_order_ref_seq;

-- 4. Liens de commande.
create table if not exists public.instagram_order_links (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete cascade,
  token text not null unique default public.random_url_token(),
  payment_reference text not null unique
    default 'OZE-IG-' || lpad(nextval('public.instagram_order_ref_seq')::text, 4, '0'),
  instagram_handle text,
  expires_at timestamptz not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  -- Choix du client
  entrupy_product_ids uuid[] not null default '{}',
  info_submitted_at timestamptz,
  transfer_declared_at timestamptz,
  -- Paiement
  paid_at timestamptz,
  paid_manually boolean not null default false,
  bank_transaction_id uuid unique references public.bank_transactions(id),
  -- Virement arrivé après expiration alors qu'un article a été revendu :
  -- à rembourser (signalé dans l'admin).
  late_payment_conflict boolean not null default false,
  -- Fin de vie
  expired_at timestamptz,
  cancelled_at timestamptz,
  -- Statut de chaque produit avant réservation { product_id: status }.
  product_prev_status jsonb not null default '{}',
  -- E-mail de facture / suivi colis
  invoice_emailed_at timestamptz,
  email_attempts int not null default 0,
  tracking_checked_at timestamptz
);
create index if not exists instagram_order_links_open_idx on public.instagram_order_links (expires_at)
  where paid_at is null and cancelled_at is null and expired_at is null;

alter table public.instagram_order_links enable row level security;
drop policy if exists instagram_order_links_admin_read on public.instagram_order_links;
create policy instagram_order_links_admin_read on public.instagram_order_links for select to authenticated
  using (public.is_admin());
-- Aucune écriture directe : tout passe par les fonctions ci-dessous.
revoke insert, update, delete on public.instagram_order_links from anon, authenticated;
revoke all on public.instagram_order_links from anon;

notify pgrst, 'reload schema';
