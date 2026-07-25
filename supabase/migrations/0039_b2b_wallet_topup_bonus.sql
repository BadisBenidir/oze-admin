-- ============================================================================
-- Module B2B Revendeurs — 39 : bonus de recharge portefeuille (+10 € offerts
-- par tranche complète de 100 € rechargés).
--
-- Calculé et crédité ICI (jamais côté client) : credit_wallet_topup reçoit
-- toujours le montant réellement payé sur Stripe (p_amount, inchangé), et
-- ajoute le bonus au solde crédité. Une seule ligne wallet_transactions,
-- avec un libellé explicite quand un bonus s'applique — signature identique
-- (même paramètres), donc CREATE OR REPLACE remplace bien la fonction sans
-- créer de surcharge.
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

  return jsonb_build_object(
    'already_processed', false, 'transaction_id', v_existing_id,
    'amount_paid', p_amount, 'bonus', v_bonus, 'total_credited', v_total
  );
end;
$$;

revoke all on function public.credit_wallet_topup(uuid, uuid, numeric, text) from public, authenticated;

notify pgrst, 'reload schema';
