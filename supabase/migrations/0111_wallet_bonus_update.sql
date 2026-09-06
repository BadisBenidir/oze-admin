-- ============================================================================
-- Mise à jour des barèmes promotionnels de recharge de portefeuille B2B :
--   - Bonus de recharge : 10 €/tranche de 100 € (0039) → 5 €/tranche de 100 €.
--   - Portefeuille offert (b2b_gift_rewards, 0101) : 1 par tranche de 500 € →
--     1 par tranche de 1 000 €.
--
-- Rétroactivité : credit_wallet_topup calcule et enregistre le bonus/la
-- quantité de portefeuilles UNE SEULE FOIS, au moment de chaque recharge
-- (wallet_transactions.amount et b2b_gift_rewards.quantity sont écrits en
-- dur à l'insert, jamais recalculés à l'affichage — voir useWallet.ts /
-- useGiftRewards.ts qui ne font que relire ces colonnes stockées). Un
-- simple CREATE OR REPLACE ne touche donc que les recharges futures : aucune
-- ligne d'historique ni aucun cadeau déjà généré n'est modifié.
-- ============================================================================

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

  v_bonus := floor(p_amount / 100) * 5;
  v_total := p_amount + v_bonus;
  v_note := case when v_bonus > 0
    then 'Recharge Stripe (+' || p_amount || ' €) + Bonus offert (+' || v_bonus || ' €)'
    else null
  end;

  update public.profiles set wallet_balance = wallet_balance + v_total where id = p_profile_id;

  insert into public.wallet_transactions (profile_id, reseller_id, amount, type, status, stripe_session_id, note)
  values (p_profile_id, p_reseller_id, v_total, 'rechargement', 'success', p_stripe_session_id, v_note)
  returning id into v_existing_id;

  v_gift_qty := floor(p_amount / 1000)::int;
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

notify pgrst, 'reload schema';
