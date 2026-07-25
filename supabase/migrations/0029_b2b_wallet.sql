-- Système de Solde / Portefeuille Revendeur (Wallet B2B).
--
-- Le solde est porté par `profiles` (individu), pas par `resellers`
-- (entreprise) : c'est la même convention déjà établie pour le panier
-- (b2b_cart_${profileId}) — chaque contact d'une même entreprise a son
-- propre panier ET son propre solde, jamais partagé. wallet_transactions
-- garde donc reseller_id (pour les vues admin agrégées par entreprise) ET
-- profile_id (pour le solde individuel réellement débité/crédité).
--
-- Sécurité : jamais de solde ni de montant de commande envoyé par le client.
-- Les deux fonctions ci-dessous sont SECURITY DEFINER et recalculent tout
-- côté serveur ; le débit du solde utilise un UPDATE conditionnel atomique
-- (WHERE wallet_balance >= montant) plutôt qu'un SELECT puis UPDATE séparés,
-- pour éliminer toute fenêtre de double-dépense en cas d'appels concurrents.

alter table public.profiles add column if not exists wallet_balance numeric not null default 0 check (wallet_balance >= 0);

create table if not exists public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id),
  reseller_id uuid not null references public.resellers (id),
  amount numeric not null check (amount > 0),
  type text not null check (type in ('rechargement', 'achat', 'remboursement')),
  status text not null default 'pending' check (status in ('pending', 'success', 'failed')),
  stripe_session_id text unique,
  order_id uuid references public.orders (id),
  created_at timestamptz not null default now()
);

create index if not exists wallet_transactions_profile_id_idx on public.wallet_transactions (profile_id);
create index if not exists wallet_transactions_reseller_id_idx on public.wallet_transactions (reseller_id);

alter table public.wallet_transactions enable row level security;

drop policy if exists "wallet_transactions_select_own" on public.wallet_transactions;
create policy "wallet_transactions_select_own" on public.wallet_transactions
  for select
  using (profile_id = auth.uid() or public.is_admin());

drop policy if exists "wallet_transactions_select_company_primary" on public.wallet_transactions;
create policy "wallet_transactions_select_company_primary" on public.wallet_transactions
  for select
  using (
    reseller_id = public.current_reseller_id()
    and exists (
      select 1 from public.reseller_contacts rc
      where rc.profile_id = auth.uid() and rc.reseller_id = wallet_transactions.reseller_id and rc.is_primary
    )
  );

revoke all on public.wallet_transactions from public, authenticated;
grant select on public.wallet_transactions to authenticated;

-- Crédit d'une recharge (appelé uniquement depuis le webhook Stripe, rôle
-- service_role). Idempotent sur stripe_session_id : un même événement Stripe
-- rejoué (retry webhook) ne credite jamais deux fois.
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
begin
  select id into v_existing_id from public.wallet_transactions where stripe_session_id = p_stripe_session_id;
  if v_existing_id is not null then
    return jsonb_build_object('already_processed', true, 'transaction_id', v_existing_id);
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Montant de recharge invalide';
  end if;

  update public.profiles set wallet_balance = wallet_balance + p_amount where id = p_profile_id;

  insert into public.wallet_transactions (profile_id, reseller_id, amount, type, status, stripe_session_id)
  values (p_profile_id, p_reseller_id, p_amount, 'rechargement', 'success', p_stripe_session_id)
  returning id into v_existing_id;

  return jsonb_build_object('already_processed', false, 'transaction_id', v_existing_id);
end;
$$;

revoke all on function public.credit_wallet_topup(uuid, uuid, numeric, text) from public, authenticated;

-- Paiement d'une commande B2B directement par le solde, sans passer par
-- Stripe. Volontairement indépendante de confirm_b2b_payment (pas de
-- refactor partagé) : confirm_b2b_payment vient tout juste d'être stabilisée
-- après un incident de dérive de signature (migration 0027) — on évite d'y
-- retoucher pour cette fonctionnalité. La duplication de la logique de
-- création de commande reflète d'ailleurs déjà l'existant (submit_b2b_order
-- vs confirm_b2b_payment).
--
-- Anti double-dépense : verrouillage de la ligne profiles (FOR UPDATE) avant
-- toute vérification/débit, dans la même transaction que la création de la
-- commande — deux appels concurrents pour le même profil sont ainsi
-- sérialisés par Postgres, le second voit le solde déjà débité par le
-- premier et échoue proprement si insuffisant.
create or replace function public.pay_b2b_order_with_wallet(
  p_reseller_id uuid,
  p_product_ids uuid[],
  p_shipping_address jsonb,
  p_billing_address jsonb,
  p_email text,
  p_placed_by_profile_id uuid,
  p_shipping_cost numeric default 0,
  p_insured_product_ids uuid[] default '{}',
  p_insurance_cost numeric default 0,
  p_grouped_with_order_id uuid default null,
  p_insured_value numeric default 0,
  p_discount_rate numeric default 0,
  p_discount_amount numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric;
  v_reserved_ids uuid[];
  v_unavailable_ids uuid[];
  v_subtotal numeric;
  v_total numeric;
  v_order_id uuid;
  v_order_number text;
  v_tx_id uuid;
begin
  if p_product_ids is null or array_length(p_product_ids, 1) is null then
    raise exception 'Aucun article dans la commande';
  end if;

  -- Verrou de ligne : sérialise les appels concurrents sur ce même profil.
  select wallet_balance into v_balance from public.profiles where id = p_placed_by_profile_id for update;
  if v_balance is null then
    raise exception 'Profil introuvable';
  end if;

  with reserved as (
    update public.products
    set status = 'sold-b2b', reserved_by_reseller_id = p_reseller_id, reserved_at = now()
    where id = any(p_product_ids) and status = 'for-sale-b2b'
    returning id
  )
  select array_agg(id) into v_reserved_ids from reserved;

  select array_agg(pid) into v_unavailable_ids
  from unnest(p_product_ids) as pid
  where pid <> all (coalesce(v_reserved_ids, array[]::uuid[]));

  if v_reserved_ids is null or array_length(v_reserved_ids, 1) is null then
    return jsonb_build_object('order_id', null, 'unavailable_ids', to_jsonb(p_product_ids));
  end if;

  select coalesce(sum(p.sale_price), 0) into v_subtotal from public.products p where p.id = any(v_reserved_ids);

  v_total := v_subtotal - coalesce(p_discount_amount, 0) + coalesce(p_shipping_cost, 0) + coalesce(p_insurance_cost, 0);

  if v_balance < v_total then
    -- Libère la réservation posée ci-dessus avant d'échouer : sinon les
    -- articles resteraient bloqués "sold-b2b" pour une commande qui n'aura
    -- jamais lieu.
    update public.products set status = 'for-sale-b2b', reserved_by_reseller_id = null, reserved_at = null
    where id = any(v_reserved_ids);
    raise exception 'Solde insuffisant';
  end if;

  update public.profiles set wallet_balance = wallet_balance - v_total where id = p_placed_by_profile_id;

  v_order_number := 'B2B-' || to_char(now(), 'YYYYMMDDHH24MISS') || '-' || substr(p_reseller_id::text, 1, 4);

  insert into public.orders (
    order_number, email, status, total_amount, subtotal, shipping_cost, insurance_cost, insured_value,
    discount_rate, discount_amount, currency,
    payment_status, shipping_address, billing_address, reseller_id, placed_by_profile_id,
    order_channel, approval_status, approved_at,
    grouped_with_order_id
  ) values (
    v_order_number, p_email, 'confirmed',
    v_total,
    v_subtotal, coalesce(p_shipping_cost, 0), coalesce(p_insurance_cost, 0), coalesce(p_insured_value, 0),
    coalesce(p_discount_rate, 0), coalesce(p_discount_amount, 0), 'EUR',
    'paid', p_shipping_address, coalesce(p_billing_address, p_shipping_address), p_reseller_id, p_placed_by_profile_id,
    'b2b', 'approved', now(),
    p_grouped_with_order_id
  )
  returning id into v_order_id;

  insert into public.order_items (order_id, product_id, quantity, unit_price, line_total, product_snapshot, insured, insurance_cost)
  select
    v_order_id, p.id, 1, p.sale_price, p.sale_price, to_jsonb(p.*),
    p.id = any(p_insured_product_ids),
    case when p.id = any(p_insured_product_ids) then round(p.sale_price * 0.006, 2) else 0 end
  from public.products p where p.id = any(v_reserved_ids);

  update public.products set reserved_by_order_id = v_order_id where id = any(v_reserved_ids);

  insert into public.wallet_transactions (profile_id, reseller_id, amount, type, status, order_id)
  values (p_placed_by_profile_id, p_reseller_id, v_total, 'achat', 'success', v_order_id)
  returning id into v_tx_id;

  return jsonb_build_object(
    'order_id', v_order_id, 'subtotal', v_subtotal, 'total', v_total,
    'unavailable_ids', to_jsonb(coalesce(v_unavailable_ids, array[]::uuid[]))
  );
end;
$$;

revoke all on function public.pay_b2b_order_with_wallet(uuid, uuid[], jsonb, jsonb, text, uuid, numeric, uuid[], numeric, uuid, numeric, numeric, numeric) from public, authenticated;

notify pgrst, 'reload schema';
