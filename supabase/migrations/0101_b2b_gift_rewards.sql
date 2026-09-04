-- ============================================================================
-- Portefeuilles offerts — suivi logistique des cadeaux dus pour tout
-- rechargement de solde revendeur >= 500 € (1 portefeuille offert par
-- tranche complète de 500 € rechargés, ex: 500 € = 1, 1 000 € = 2...).
--
-- Le seuil s'applique au montant RÉELLEMENT PAYÉ par le client (p_amount,
-- paramètre déjà reçu tel quel par credit_wallet_topup — voir 0029/0039),
-- jamais au solde effectivement crédité qui inclut en plus le bonus de
-- recharge (+10 €/tranche de 100 €, voir 0039) : un bonus ne doit jamais
-- faire franchir artificiellement le seuil des 500 €.
--
-- Table dédiée (pas de champ ajouté à wallet_transactions) : une recharge
-- peut donner droit à PLUSIEURS portefeuilles (quantity), et leur cycle de
-- vie (assigné à une commande, expédié) n'a rien à voir avec la transaction
-- de solde elle-même.
-- ============================================================================

create table if not exists public.b2b_gift_rewards (
  id uuid primary key default gen_random_uuid(),
  reseller_id uuid not null references public.resellers (id) on delete cascade,
  profile_id uuid not null references public.profiles (id),
  -- unique : une même recharge ne peut générer qu'une seule ligne de suivi
  -- (quantity porte le nombre de portefeuilles), jamais réinsérée deux fois
  -- même si credit_wallet_topup ou le script de rattrapage rejouent dessus.
  transaction_id uuid not null unique references public.wallet_transactions (id) on delete cascade,
  recharge_amount numeric(10, 2) not null check (recharge_amount > 0),
  quantity int not null check (quantity > 0),
  status text not null default 'pending' check (status in ('pending', 'assigned', 'shipped')),
  assigned_order_id uuid references public.orders (id) on delete set null,
  shipped_at timestamptz,
  shipped_note text,
  created_at timestamptz not null default now()
);

create index if not exists b2b_gift_rewards_status_idx on public.b2b_gift_rewards (status);
create index if not exists b2b_gift_rewards_reseller_id_idx on public.b2b_gift_rewards (reseller_id);
create index if not exists b2b_gift_rewards_assigned_order_id_idx on public.b2b_gift_rewards (assigned_order_id);

alter table public.b2b_gift_rewards enable row level security;

drop policy if exists b2b_gift_rewards_admin_all on public.b2b_gift_rewards;
create policy b2b_gift_rewards_admin_all on public.b2b_gift_rewards
  for all using (public.is_admin()) with check (public.is_admin());

revoke all on public.b2b_gift_rewards from public, authenticated;
grant select, insert, update, delete on public.b2b_gift_rewards to authenticated;

-- ----------------------------------------------------------------------------
-- Détection automatique : recrée credit_wallet_topup (même signature que
-- 0039, donc CREATE OR REPLACE la remplace bien) pour générer la ligne de
-- suivi dès qu'une recharge Stripe atteint le seuil.
-- ----------------------------------------------------------------------------
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
  v_gift_qty int;
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

  insert into public.wallet_transactions (profile_id, reseller_id, amount, type, status, stripe_session_id, note)
  values (p_profile_id, p_reseller_id, v_total, 'rechargement', 'success', p_stripe_session_id, v_note)
  returning id into v_existing_id;

  v_gift_qty := floor(p_amount / 500)::int;
  if v_gift_qty > 0 then
    insert into public.b2b_gift_rewards (reseller_id, profile_id, transaction_id, recharge_amount, quantity, status)
    values (p_reseller_id, p_profile_id, v_existing_id, p_amount, v_gift_qty, 'pending');
  end if;

  return jsonb_build_object(
    'already_processed', false, 'transaction_id', v_existing_id,
    'amount_paid', p_amount, 'bonus', v_bonus, 'total_credited', v_total, 'gift_quantity', coalesce(v_gift_qty, 0)
  );
end;
$$;

revoke all on function public.credit_wallet_topup(uuid, uuid, numeric, text) from public, authenticated;

-- ----------------------------------------------------------------------------
-- Rétroactivité : génère les portefeuilles dus pour les recharges déjà
-- existantes >= 500 €. Le montant réellement payé est reconstitué depuis le
-- libellé "Recharge Stripe (+X €) + Bonus offert (+Y €)" posé par le calcul
-- de bonus ci-dessus (texte généré par cette fonction, donc fiable à
-- parser) quand un bonus s'est appliqué ; sinon amount == montant payé
-- (aucun bonus n'a jamais modifié la valeur créditée).
-- ----------------------------------------------------------------------------
insert into public.b2b_gift_rewards (reseller_id, profile_id, transaction_id, recharge_amount, quantity, status, created_at)
select
  wt.reseller_id,
  wt.profile_id,
  wt.id,
  raw.raw_amount,
  floor(raw.raw_amount / 500)::int,
  'pending',
  wt.created_at
from public.wallet_transactions wt
cross join lateral (
  select coalesce((regexp_match(wt.note, 'Recharge Stripe \(\+([\d.]+) €\)'))[1]::numeric, wt.amount) as raw_amount
) raw
where wt.type = 'rechargement' and wt.status = 'success'
  and floor(raw.raw_amount / 500) >= 1
on conflict (transaction_id) do nothing;

notify pgrst, 'reload schema';
