-- ============================================================================
-- Conversion d'un remboursement en crédit portefeuille en remboursement par
-- carte (Edge Function convert-item-refund-to-card) : le crédit accordé à
-- l'annulation d'un article est retiré du portefeuille, puis remboursé par
-- Stripe. Débit atomique, refusé si le solde ne couvre pas le montant (crédit
-- déjà dépensé). Réservé au service (appelé par l'Edge Function, après
-- contrôle des droits admin « refunds »).
-- ============================================================================

create or replace function public.debit_wallet_for_card_refund(
  p_profile_id uuid,
  p_reseller_id uuid,
  p_amount numeric,
  p_order_id uuid,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_balance numeric;
  v_transaction_id uuid;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Montant invalide';
  end if;

  update public.profiles
  set wallet_balance = wallet_balance - p_amount
  where id = p_profile_id and wallet_balance >= p_amount
  returning wallet_balance into v_new_balance;

  if not found then
    raise exception 'Solde insuffisant : le crédit a déjà été (en partie) dépensé par le membre';
  end if;

  insert into public.wallet_transactions (profile_id, reseller_id, amount, type, status, order_id, note, acknowledged_at)
  values (p_profile_id, p_reseller_id, -p_amount, 'ajustement_admin', 'success', p_order_id, p_note, now())
  returning id into v_transaction_id;

  return jsonb_build_object('new_balance', v_new_balance, 'transaction_id', v_transaction_id);
end;
$$;

revoke all on function public.debit_wallet_for_card_refund(uuid, uuid, numeric, uuid, text) from public, anon, authenticated;
grant execute on function public.debit_wallet_for_card_refund(uuid, uuid, numeric, uuid, text) to service_role;
