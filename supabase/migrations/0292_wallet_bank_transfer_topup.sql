-- ============================================================================
-- Rechargement du portefeuille B2B par VIREMENT, avec bonus (+5 € par
-- tranche complète de 100 €), crédité automatiquement à la synchro Qonto.
--
--   - wallet_settings (une ligne) : taux du bonus virement, minimum pour le
--     bonus, bénéficiaire / IBAN / BIC (préremplis par qonto-sync) —
--     modifiables dans l'admin, sans redéploiement.
--   - profiles.wallet_transfer_reference : référence unique du membre
--     (OZE-R-0042), à recopier dans le libellé du virement.
--   - profiles.wallet_bonus_balance : part BONUS du solde (incluse dans
--     wallet_balance). Utilisable seulement en achats, jamais remboursée :
--     le remboursement d'un solde est plafonné à wallet_balance − bonus.
--     Les soldes existants sont considérés comme payés (bonus passés non
--     suivis, décision admin).
--   - Achat payé par le portefeuille : le bonus est consommé EN PREMIER et
--     noté sur la commande (orders.wallet_bonus_used) : remise commerciale,
--     déduite du CA et de la base de TVA de la vente. Remboursement d'une
--     commande sur le portefeuille : le bonus utilisé est rendu en bonus.
--   - credit_wallet_transfer(transaction Qonto, membre) : crédite montant +
--     bonus (0 sous le minimum), relie le crédit à la transaction Qonto
--     (index unique : un virement = un seul crédit), notifie le membre.
--   - wallet_match_transfers() : appelée par qonto-sync, crédite les
--     virements entrants dont le libellé contient une référence connue ;
--     les autres restent à attribuer à la main dans l'admin.
--   - credit_wallet_topup (carte Stripe) : plus de bonus (bonus réservé au
--     virement) ; reste inchangé sinon (programme portefeuilles offerts).
-- ============================================================================

-- 1. Réglages -----------------------------------------------------------------
create table if not exists public.wallet_settings (
  id boolean primary key default true check (id),
  transfer_bonus_rate numeric(5, 4) not null default 0.05 check (transfer_bonus_rate >= 0 and transfer_bonus_rate < 1),
  transfer_min_amount numeric(10, 2) not null default 100 check (transfer_min_amount >= 0),
  beneficiary text not null default 'OZË PARIS SAS',
  iban text,
  bic text,
  updated_at timestamptz not null default now()
);
insert into public.wallet_settings (id) values (true) on conflict (id) do nothing;

alter table public.wallet_settings enable row level security;
drop policy if exists wallet_settings_read on public.wallet_settings;
create policy wallet_settings_read on public.wallet_settings for select to authenticated using (true);
drop policy if exists wallet_settings_admin_update on public.wallet_settings;
create policy wallet_settings_admin_update on public.wallet_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- 2. Colonnes -----------------------------------------------------------------
alter table public.profiles add column if not exists wallet_transfer_reference text;
create unique index if not exists profiles_wallet_transfer_reference_key on public.profiles (wallet_transfer_reference)
  where wallet_transfer_reference is not null;
create sequence if not exists public.wallet_transfer_reference_seq start 1;

alter table public.profiles add column if not exists wallet_bonus_balance numeric(10, 2) not null default 0
  check (wallet_bonus_balance >= 0);

alter table public.wallet_transactions add column if not exists bank_transaction_id uuid references public.bank_transactions(id);
create unique index if not exists wallet_transactions_bank_transaction_key on public.wallet_transactions (bank_transaction_id)
  where bank_transaction_id is not null;
alter table public.wallet_transactions add column if not exists bonus_amount numeric(10, 2) not null default 0;

alter table public.orders add column if not exists wallet_bonus_used numeric(10, 2) not null default 0
  check (wallet_bonus_used >= 0);
comment on column public.orders.wallet_bonus_used is
  'Bonus portefeuille (virement, 0292) utilisé pour payer la commande : remise commerciale, déduite du CA et de la base de TVA.';

alter table public.bank_transactions drop constraint if exists bank_transactions_matched_type_check;
alter table public.bank_transactions add constraint bank_transactions_matched_type_check
  check (matched_type = any (array['order', 'sourcing_mission', 'expense', 'stripe_payout', 'other', 'wallet_topup']));

-- 3. Référence du membre ------------------------------------------------------
create or replace function public.ensure_wallet_transfer_reference(p_profile_id uuid default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := coalesce(p_profile_id, auth.uid());
  v_ref text;
begin
  if v_id is null then
    raise exception 'Non authentifié';
  end if;
  if p_profile_id is not null and p_profile_id <> coalesce(auth.uid(), p_profile_id) and not public.is_admin() then
    raise exception 'Accès refusé';
  end if;
  select wallet_transfer_reference into v_ref from public.profiles where id = v_id for update;
  if v_ref is null then
    v_ref := 'OZE-R-' || lpad(nextval('public.wallet_transfer_reference_seq')::text, 4, '0');
    update public.profiles set wallet_transfer_reference = v_ref where id = v_id;
  end if;
  return v_ref;
end;
$$;
revoke all on function public.ensure_wallet_transfer_reference(uuid) from public, anon;
grant execute on function public.ensure_wallet_transfer_reference(uuid) to authenticated;

-- 4. Bonus virement -----------------------------------------------------------
create or replace function public.wallet_transfer_bonus(p_amount numeric)
returns numeric
language sql
stable
set search_path = public
as $$
  select case when p_amount >= s.transfer_min_amount
              then round(floor(p_amount / 100) * s.transfer_bonus_rate * 100, 2)
              else 0 end
  from public.wallet_settings s where s.id;
$$;
grant execute on function public.wallet_transfer_bonus(numeric) to authenticated;

-- 5. Crédit d'un virement -----------------------------------------------------
create or replace function public.credit_wallet_transfer(p_bank_transaction_id uuid, p_profile_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx public.bank_transactions;
  v_profile public.profiles;
  v_existing uuid;
  v_bonus numeric;
  v_total numeric;
  v_wt uuid;
  v_cumulative_paid numeric;
  v_new_gifts int;
  v_reseller uuid;
begin
  -- Serveur (qonto-sync : auth.uid() nul) ou admin.
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'Accès refusé : réservé aux administrateurs';
  end if;

  select * into v_tx from public.bank_transactions where id = p_bank_transaction_id for update;
  if not found then raise exception 'Transaction Qonto introuvable'; end if;
  if v_tx.side <> 'credit' or coalesce(v_tx.qonto_status, 'completed') <> 'completed' or v_tx.amount <= 0 then
    raise exception 'Seul un virement entrant reçu peut recharger un portefeuille';
  end if;

  -- Anti-doublon : une transaction Qonto = un seul crédit.
  select id into v_existing from public.wallet_transactions where bank_transaction_id = p_bank_transaction_id;
  if v_existing is not null then
    return jsonb_build_object('already_processed', true, 'transaction_id', v_existing);
  end if;

  select * into v_profile from public.profiles where id = p_profile_id for update;
  if not found then raise exception 'Membre introuvable'; end if;

  select rc.reseller_id into v_reseller from public.reseller_contacts rc where rc.profile_id = p_profile_id limit 1;
  if v_reseller is null then raise exception 'Ce membre n''est rattaché à aucun revendeur'; end if;

  v_bonus := public.wallet_transfer_bonus(v_tx.amount);
  v_total := v_tx.amount + v_bonus;

  update public.profiles
  set wallet_balance = wallet_balance + v_total,
      wallet_bonus_balance = wallet_bonus_balance + v_bonus
  where id = p_profile_id;

  insert into public.wallet_transactions (profile_id, reseller_id, amount, type, status, note, paid_amount, bonus_amount, bank_transaction_id)
  values (p_profile_id, v_reseller, v_total, 'rechargement', 'success',
          'Recharge par virement (+' || to_char(v_tx.amount, 'FM999999990.00') || ' €)'
            || case when v_bonus > 0 then ' + Bonus virement (+' || to_char(v_bonus, 'FM999999990.00') || ' €)' else '' end,
          v_tx.amount, v_bonus, p_bank_transaction_id)
  returning id into v_wt;

  update public.bank_transactions
  set reconciliation_status = 'matched', matched_type = 'wallet_topup',
      note = 'Recharge portefeuille ' || coalesce(v_profile.wallet_transfer_reference, '') || ' — '
             || trim(coalesce(v_profile.first_name, '') || ' ' || coalesce(v_profile.last_name, '')),
      updated_at = now()
  where id = p_bank_transaction_id;

  -- Programme « portefeuilles offerts » (même règle que la carte, 0111).
  select coalesce(sum(paid_amount), 0) into v_cumulative_paid
  from public.wallet_transactions where profile_id = p_profile_id and type = 'rechargement';
  v_new_gifts := floor((v_cumulative_paid - coalesce(v_profile.loyalty_progress_checkpoint, 0)) / 1000);
  if v_new_gifts > 0 then
    insert into public.b2b_gift_rewards (reseller_id, profile_id, transaction_id, recharge_amount, quantity, status)
    values (v_reseller, p_profile_id, v_wt, v_tx.amount, v_new_gifts, 'pending');
    update public.profiles
    set loyalty_gifts_unlocked = loyalty_gifts_unlocked + v_new_gifts,
        loyalty_progress_checkpoint = loyalty_progress_checkpoint + v_new_gifts * 1000
    where id = p_profile_id;
  end if;

  return jsonb_build_object('already_processed', false, 'transaction_id', v_wt, 'amount_paid', v_tx.amount,
                            'bonus', v_bonus, 'total_credited', v_total, 'profile_id', p_profile_id);
end;
$$;
revoke all on function public.credit_wallet_transfer(uuid, uuid) from public, anon;
grant execute on function public.credit_wallet_transfer(uuid, uuid) to authenticated, service_role;

-- 6. Rapprochement automatique (qonto-sync) -----------------------------------
create or replace function public.wallet_match_transfers()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_ref text;
  v_profile uuid;
  n int := 0;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'Accès refusé';
  end if;
  for r in
    select b.id, upper(coalesce(b.raw->>'reference', '') || ' ' || coalesce(b.label, '') || ' ' || coalesce(b.raw->>'note', '')) txt
    from public.bank_transactions b
    where b.side = 'credit' and coalesce(b.qonto_status, 'completed') = 'completed'
      and b.reconciliation_status = 'unmatched' and b.amount > 0
      and not exists (select 1 from public.wallet_transactions w where w.bank_transaction_id = b.id)
  loop
    -- « OZE-R-0042 », « OZE R 0042 », « OZER0042 »… → OZE-R-0042.
    v_ref := (regexp_match(r.txt, 'OZ[EË]\s*-?\s*R\s*-?\s*(\d{1,6})'))[1];
    if v_ref is null then continue; end if;
    select id into v_profile from public.profiles where wallet_transfer_reference = 'OZE-R-' || lpad(ltrim(v_ref, '0'), 4, '0');
    if v_profile is null then continue; end if;   -- référence inconnue : à attribuer à la main
    perform public.credit_wallet_transfer(r.id, v_profile);
    n := n + 1;
  end loop;
  return jsonb_build_object('credited', n);
end;
$$;
revoke all on function public.wallet_match_transfers() from public, anon;
grant execute on function public.wallet_match_transfers() to authenticated, service_role;

-- 7. Bonus consommé en premier à l'achat, rendu au remboursement -------------
create or replace function public.wallet_bonus_on_transaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_use numeric;
  v_back numeric;
begin
  if new.status <> 'success' or (tg_op = 'UPDATE' and old.status = 'success') then
    return new;
  end if;
  if new.type = 'achat' then
    select least(wallet_bonus_balance, abs(new.amount)) into v_use from public.profiles where id = new.profile_id for update;
    if coalesce(v_use, 0) > 0 then
      update public.profiles set wallet_bonus_balance = wallet_bonus_balance - v_use where id = new.profile_id;
      if new.order_id is not null then
        update public.orders set wallet_bonus_used = wallet_bonus_used + v_use where id = new.order_id;
      end if;
    end if;
  elsif new.type = 'remboursement' and new.order_id is not null then
    select least(wallet_bonus_used, abs(new.amount)) into v_back from public.orders where id = new.order_id for update;
    if coalesce(v_back, 0) > 0 then
      update public.orders set wallet_bonus_used = wallet_bonus_used - v_back where id = new.order_id;
      update public.profiles set wallet_bonus_balance = wallet_bonus_balance + v_back where id = new.profile_id;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists wallet_transactions_bonus on public.wallet_transactions;
create trigger wallet_transactions_bonus after insert or update of status on public.wallet_transactions
  for each row execute function public.wallet_bonus_on_transaction();

-- Le bonus ne dépasse jamais le solde (ajustement admin négatif, etc.).
create or replace function public.profiles_clamp_wallet_bonus()
returns trigger
language plpgsql
as $$
begin
  if new.wallet_bonus_balance > greatest(new.wallet_balance, 0) then
    new.wallet_bonus_balance := greatest(new.wallet_balance, 0);
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_clamp_wallet_bonus on public.profiles;
create trigger profiles_clamp_wallet_bonus before update of wallet_balance, wallet_bonus_balance on public.profiles
  for each row execute function public.profiles_clamp_wallet_bonus();

-- 8. Carte Stripe : plus de bonus (réservé au virement) -----------------------
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
  v_total numeric;
  v_cumulative_paid numeric;
  v_checkpoint numeric;
  v_progress numeric;
  v_new_gifts integer;
begin
  select id into v_existing_id from public.wallet_transactions where stripe_session_id = p_stripe_session_id;
  if v_existing_id is not null then
    return jsonb_build_object('already_processed', true, 'transaction_id', v_existing_id);
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Montant de recharge invalide';
  end if;

  v_total := p_amount;

  update public.profiles set wallet_balance = wallet_balance + v_total where id = p_profile_id;

  insert into public.wallet_transactions (profile_id, reseller_id, amount, type, status, stripe_session_id, note, paid_amount)
  values (p_profile_id, p_reseller_id, v_total, 'rechargement', 'success', p_stripe_session_id, null, p_amount)
  returning id into v_existing_id;

  select loyalty_progress_checkpoint into v_checkpoint from public.profiles where id = p_profile_id for update;

  select coalesce(sum(paid_amount), 0) into v_cumulative_paid
  from public.wallet_transactions
  where profile_id = p_profile_id and type = 'rechargement';

  v_progress := v_cumulative_paid - v_checkpoint;
  v_new_gifts := floor(v_progress / 1000);

  if v_new_gifts > 0 then
    insert into public.b2b_gift_rewards (reseller_id, profile_id, transaction_id, recharge_amount, quantity, status)
    values (p_reseller_id, p_profile_id, v_existing_id, p_amount, v_new_gifts, 'pending');

    update public.profiles
    set loyalty_gifts_unlocked = loyalty_gifts_unlocked + v_new_gifts,
        loyalty_progress_checkpoint = loyalty_progress_checkpoint + v_new_gifts * 1000
    where id = p_profile_id;
  end if;

  return jsonb_build_object(
    'already_processed', false, 'transaction_id', v_existing_id,
    'amount_paid', p_amount, 'bonus', 0, 'total_credited', v_total,
    'cumulative_paid', v_cumulative_paid, 'gifts_assigned', v_new_gifts
  );
end;
$$;

notify pgrst, 'reload schema';
