-- ============================================================================
-- Paiement mixte (solde + carte) pour un lot d'enchère adjugé, sur le même
-- principe que le paiement mixte du panier B2B classique (0036) : le
-- revendeur n'est plus forcé de choisir entre "tout solde" (refusé si le
-- solde ne couvre pas le total) et "tout carte" — s'il a un solde partiel,
-- il peut l'utiliser en totalité et compléter par carte pour le reste. Il
-- garde aussi la possibilité de payer entièrement par carte même s'il a du
-- solde disponible.
--
-- Contrairement au panier classique, la commande d'enchère EXISTE déjà avec
-- son total_amount définitif au moment du paiement (générée à l'adjudication
-- par generate_order_from_auction_item_core) : finalize_wallet_order_debit
-- (0036) ne peut donc pas être réutilisée telle quelle, elle ADDITIONNE la
-- part solde à total_amount (correct pour le panier, où confirm_b2b_payment
-- ne connaît que la part carte au moment de créer la commande) — ça
-- compterait la part solde deux fois ici. finalize_auction_wallet_debit
-- fait la même chose SANS toucher à total_amount.
--
-- debit_wallet_amount et refund_pending_wallet_debit (0036) sont réutilisées
-- telles quelles : génériques, indexées sur stripe_session_id, sans notion
-- de type de commande.
-- ============================================================================

create or replace function public.finalize_auction_wallet_debit(
  p_stripe_session_id text,
  p_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx record;
begin
  select * into v_tx from public.wallet_transactions
  where stripe_session_id = p_stripe_session_id and status = 'pending'
  for update;

  if not found then
    return jsonb_build_object('found', false);
  end if;

  update public.wallet_transactions set status = 'success', order_id = p_order_id where id = v_tx.id;

  return jsonb_build_object('found', true, 'amount', v_tx.amount);
end;
$$;

revoke all on function public.finalize_auction_wallet_debit(text, uuid) from public, authenticated;

notify pgrst, 'reload schema';
