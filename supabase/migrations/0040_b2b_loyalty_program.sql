-- ============================================================================
-- Module B2B Revendeurs — 40 : programme de fidélité (1 cadeau de luxe tous
-- les 500 € cumulés de recharge portefeuille)
--
-- - products.status gagne 'cadeau' (en attente d'attribution, masqué du
--   catalogue B2B standard puisque b2b_catalog ne montre que 'for-sale-b2b'),
--   'cadeau-attribue' (réservé à un revendeur, pas encore inclus dans une
--   commande) et 'cadeau-livre' (terminal, inclus dans une commande).
-- - wallet_transactions.paid_amount : montant RÉELLEMENT payé sur Stripe pour
--   une recharge, distinct de `amount` qui inclut désormais le bonus (voir
--   0039). Le palier de fidélité se calcule sur le cumul PAYÉ, pas crédité.
-- - profiles.loyalty_gifts_unlocked : nombre de paliers de 500 € déjà
--   convertis en attribution de cadeau (pas juste "atteints" : si aucun
--   produit 'cadeau' n'est disponible en stock, le palier reste en attente
--   et sera retenté à la prochaine recharge).
-- - loyalty_gifts : historique/état de chaque cadeau attribué.
-- ============================================================================

alter table public.products drop constraint if exists products_status_check;
alter table public.products
  add constraint products_status_check check (status in (
    'draft', 'for-sale-online', 'for-sale-other-platform', 'sold-online',
    'sold-other-platform', 'sold-display', 'for-auction-live', 'sold-auction',
    'for-sale-b2b', 'reserved-b2b', 'sold-b2b', 'archived',
    'cadeau', 'cadeau-attribue', 'cadeau-livre'
  ));

alter table public.wallet_transactions add column if not exists paid_amount numeric;
-- Backfill : toutes les recharges déjà en base ont été créées avant le bonus
-- (0039) — leur `amount` stocké est donc déjà, à l'époque, le montant payé.
update public.wallet_transactions set paid_amount = amount where type = 'rechargement' and paid_amount is null;

alter table public.profiles add column if not exists loyalty_gifts_unlocked integer not null default 0;

alter table public.order_items add column if not exists is_loyalty_gift boolean not null default false;

create table if not exists public.loyalty_gifts (
  id uuid primary key default gen_random_uuid(),
  reseller_id uuid not null references public.resellers (id),
  profile_id uuid not null references public.profiles (id),
  product_id uuid not null references public.products (id),
  tier_reached integer not null,
  status text not null default 'pending_discovery' check (status in ('pending_discovery', 'discovered', 'included_in_order')),
  order_id uuid references public.orders (id),
  assigned_at timestamptz not null default now(),
  discovered_at timestamptz,
  included_at timestamptz
);

create index if not exists loyalty_gifts_reseller_id_idx on public.loyalty_gifts (reseller_id);
create index if not exists loyalty_gifts_profile_id_idx on public.loyalty_gifts (profile_id);

alter table public.loyalty_gifts enable row level security;

drop policy if exists loyalty_gifts_admin_all on public.loyalty_gifts;
create policy loyalty_gifts_admin_all on public.loyalty_gifts
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists loyalty_gifts_reseller_select_own on public.loyalty_gifts;
create policy loyalty_gifts_reseller_select_own on public.loyalty_gifts
  for select using (reseller_id = public.current_reseller_id());

----------------------------------------------------------------------------
-- credit_wallet_topup : ajoute, après le crédit habituel (0039), la
-- vérification/déblocage des paliers de fidélité sur le cumul PAYÉ. Même
-- signature qu'avant → remplace proprement, pas de surcharge.
----------------------------------------------------------------------------
create or replace function public.credit_wallet_topup(
  p_profile_id uuid,
  p_reseller_id uuid,
  p_amount numeric,
  p_stripe_session_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_id uuid;
  v_bonus numeric;
  v_total numeric;
  v_note text;
  v_cumulative_paid numeric;
  v_target_tiers integer;
  v_current_tiers integer;
  v_gift_product_id uuid;
  v_gift_product_name text;
  v_gift_id uuid;
  v_gifts_assigned integer := 0;
begin
  select id into v_existing_id from public.wallet_transactions where stripe_session_id = p_stripe_session_id;
  if v_existing_id is not null then
    return jsonb_build_object('already_processed', true, 'transaction_id', v_existing_id);
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Montant de recharge invalide';
  end if;

  v_bonus := floor(p_amount / 100) * 10;
  v_total := p_amount + v_bonus;
  v_note := case when v_bonus > 0
    then 'Recharge Stripe (+' || p_amount || ' €) + Bonus offert (+' || v_bonus || ' €)'
    else null
  end;

  update public.profiles set wallet_balance = wallet_balance + v_total where id = p_profile_id;

  insert into public.wallet_transactions (profile_id, reseller_id, amount, type, status, stripe_session_id, note, paid_amount)
  values (p_profile_id, p_reseller_id, v_total, 'rechargement', 'success', p_stripe_session_id, v_note, p_amount)
  returning id into v_existing_id;

  -- Programme fidélité : cumul PAYÉ (jamais le total crédité incluant le
  -- bonus) — 1 cadeau débloqué tous les 500 €, potentiellement plusieurs
  -- d'un coup sur une grosse recharge.
  select coalesce(sum(paid_amount), 0) into v_cumulative_paid
  from public.wallet_transactions
  where profile_id = p_profile_id and type = 'rechargement';

  v_target_tiers := floor(v_cumulative_paid / 500);

  select loyalty_gifts_unlocked into v_current_tiers from public.profiles where id = p_profile_id for update;

  while v_current_tiers < v_target_tiers loop
    -- Réclamation atomique en une seule instruction (idiome déjà utilisé
    -- ailleurs dans ce projet pour les files d'attente concurrentes) plutôt
    -- qu'un SELECT ... FOR UPDATE SKIP LOCKED suivi d'un UPDATE séparé.
    update public.products
    set status = 'cadeau-attribue'
    where id = (
      select id from public.products
      where status = 'cadeau'
      order by created_at asc
      limit 1
      for update skip locked
    )
    returning id, name into v_gift_product_id, v_gift_product_name;

    if not found then
      -- Plus de cadeau disponible en stock : le palier reste en attente,
      -- sera retenté automatiquement à la prochaine recharge.
      exit;
    end if;

    insert into public.loyalty_gifts (reseller_id, profile_id, product_id, tier_reached, status)
    values (p_reseller_id, p_profile_id, v_gift_product_id, v_current_tiers + 1, 'pending_discovery')
    returning id into v_gift_id;

    v_current_tiers := v_current_tiers + 1;
    v_gifts_assigned := v_gifts_assigned + 1;
    update public.profiles set loyalty_gifts_unlocked = v_current_tiers where id = p_profile_id;
  end loop;

  return jsonb_build_object(
    'already_processed', false, 'transaction_id', v_existing_id,
    'amount_paid', p_amount, 'bonus', v_bonus, 'total_credited', v_total,
    'cumulative_paid', v_cumulative_paid, 'gifts_assigned', v_gifts_assigned
  );
end;
$$;

revoke all on function public.credit_wallet_topup(uuid, uuid, numeric, text) from public, authenticated;

----------------------------------------------------------------------------
-- mark_loyalty_gift_discovered : le revendeur ouvre la fiche de son cadeau
-- ("Découvrir mon cadeau !"). Vérifie que le cadeau lui appartient bien.
----------------------------------------------------------------------------
create or replace function public.mark_loyalty_gift_discovered(p_gift_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reseller_id uuid;
begin
  v_reseller_id := public.current_reseller_id();
  if v_reseller_id is null then
    raise exception 'Aucun compte revendeur actif';
  end if;

  update public.loyalty_gifts
  set status = 'discovered', discovered_at = coalesce(discovered_at, now())
  where id = p_gift_id and reseller_id = v_reseller_id and status = 'pending_discovery';

  if not found then
    return jsonb_build_object('updated', false);
  end if;
  return jsonb_build_object('updated', true);
end;
$$;

grant execute on function public.mark_loyalty_gift_discovered(uuid) to authenticated;

----------------------------------------------------------------------------
-- get_my_pending_loyalty_gifts : expose les cadeaux non encore inclus dans
-- une commande du profil connecté, avec les détails produit nécessaires à
-- l'affichage (photos, grade, description). Aucune policy RLS reseller
-- vérifiée n'existe sur `products` dans ce dépôt (voir 0002_b2b_rls.sql,
-- audit manuel requis) — comme pour `b2b_catalog`, on contourne ce flou en
-- passant par une fonction SECURITY DEFINER plutôt qu'un join direct côté
-- client sur `products`.
----------------------------------------------------------------------------
create or replace function public.get_my_pending_loyalty_gifts()
returns table (
  id uuid,
  product_id uuid,
  tier_reached integer,
  status text,
  assigned_at timestamptz,
  product_name text,
  product_images jsonb,
  product_main_image_index integer,
  product_condition text,
  product_description text
)
language sql
security definer
stable
set search_path = public
as $$
  select lg.id, lg.product_id, lg.tier_reached, lg.status, lg.assigned_at,
         p.name, p.images, p.main_image_index, p.condition, p.description
  from public.loyalty_gifts lg
  join public.products p on p.id = lg.product_id
  where lg.profile_id = auth.uid()
    and lg.order_id is null
  order by lg.assigned_at asc;
$$;

grant execute on function public.get_my_pending_loyalty_gifts() to authenticated;

----------------------------------------------------------------------------
-- attach_pending_loyalty_gift : appelée après création d'une commande B2B
-- (b2b-checkout pour le paiement solde, b2b-stripe-webhook pour carte/mixte)
-- — ajoute automatiquement la ligne "Cadeau Fidélité" à 0 € si ce revendeur
-- a un cadeau en attente non encore inclus dans une commande. Service-role
-- uniquement (jamais depuis le client, qui ne doit pas décider seul si un
-- cadeau est ajouté).
----------------------------------------------------------------------------
create or replace function public.attach_pending_loyalty_gift(
  p_order_id uuid,
  p_reseller_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gift_id uuid;
  v_product_id uuid;
  v_snapshot jsonb;
  v_name text;
begin
  -- Réclamation atomique en une seule instruction (même idiome que dans
  -- credit_wallet_topup ci-dessus) : évite toute fenêtre entre lecture et
  -- verrouillage si deux commandes du même revendeur se confirment en même
  -- temps (paiement carte + solde quasi simultanés, par exemple).
  update public.loyalty_gifts
  set order_id = p_order_id, status = 'included_in_order', included_at = now()
  where id = (
    select lg.id
    from public.loyalty_gifts lg
    where lg.reseller_id = p_reseller_id
      and lg.status in ('pending_discovery', 'discovered')
      and lg.order_id is null
    order by lg.assigned_at asc
    limit 1
    for update skip locked
  )
  returning id, product_id into v_gift_id, v_product_id;

  if not found then
    return jsonb_build_object('attached', false);
  end if;

  select to_jsonb(p.*), p.name into v_snapshot, v_name from public.products p where p.id = v_product_id;

  insert into public.order_items (order_id, product_id, quantity, unit_price, line_total, product_snapshot, is_loyalty_gift)
  values (p_order_id, v_product_id, 1, 0, 0, v_snapshot, true);

  update public.products set status = 'cadeau-livre' where id = v_product_id;

  return jsonb_build_object('attached', true, 'product_name', v_name);
end;
$$;

revoke all on function public.attach_pending_loyalty_gift(uuid, uuid) from public, authenticated;

notify pgrst, 'reload schema';
