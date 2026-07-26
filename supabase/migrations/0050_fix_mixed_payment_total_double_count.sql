-- ============================================================================
-- Module B2B Revendeurs — 50 : FIX URGENT — total_amount doublement compté
-- sur les commandes payées en mode "mixte" (carte + solde portefeuille).
--
-- Incident (2026-07-27) : une commande à 58,35 € (58 € article + 0,35 €
-- assurance, livraison 0 €) affichait un total de 97,58 €.
--
-- Cause racine : confirm_b2b_payment (0027) recalcule déjà v_subtotal à
-- partir du PRIX PLEIN de products.sale_price (jamais réduit par la part
-- carte/solde), donc total_amount = subtotal - discount + shipping +
-- insurance est déjà le montant COMPLET de la commande dès l'insertion —
-- indépendant de la façon dont elle a été financée.
--
-- finalize_wallet_order_debit (0036) supposait pourtant l'inverse (voir son
-- propre commentaire : "confirm_b2b_payment ne connaissait que la part
-- carte") et faisait `total_amount = total_amount + montant_solde` après
-- coup — ajoutant donc la part solde UNE SECONDE FOIS sur un total qui
-- l'incluait déjà. Toute commande "mixte" (carte + solde) passée jusqu'ici
-- a ce défaut, sauf si elle a été intégralement annulée depuis (l'annulation
-- recalcule total_amount à partir des articles actifs restants et écrase
-- donc la valeur erronée).
-- ============================================================================

create or replace function public.finalize_wallet_order_debit(
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

  -- confirm_b2b_payment a déjà inséré le total COMPLET de la commande (voir
  -- ci-dessus) : cette fonction ne fait plus que rattacher/finaliser la
  -- transaction de solde, elle ne touche plus à orders.total_amount.
  update public.wallet_transactions set status = 'success', order_id = p_order_id where id = v_tx.id;

  return jsonb_build_object('found', true, 'amount', v_tx.amount);
end;
$$;

revoke all on function public.finalize_wallet_order_debit(text, uuid) from public, authenticated;

-- Correction rétroactive : toute commande "mixte" (passée par Stripe, donc
-- stripe_session_id non nul) dont le total_amount actuel ne correspond pas
-- à la formule officielle est recalculée. Ne touche jamais une commande
-- payée 100% en solde (pay_b2b_order_with_wallet, pas de stripe_session_id)
-- ni une commande déjà annulée depuis (son total, déjà recalculé sur ses
-- articles actifs restants, ne sera par définition pas concerné puisqu'il
-- provient d'une autre formule légitime que celle testée ici).
update public.orders o
set total_amount = o.subtotal - coalesce(o.discount_amount, 0) + coalesce(o.shipping_cost, 0) + coalesce(o.insurance_cost, 0)
where o.order_channel = 'b2b'
  and o.stripe_session_id is not null
  and exists (
    select 1 from public.wallet_transactions wt
    where wt.order_id = o.id and wt.type = 'achat' and wt.status = 'success'
  )
  and o.total_amount <> (o.subtotal - coalesce(o.discount_amount, 0) + coalesce(o.shipping_cost, 0) + coalesce(o.insurance_cost, 0));

notify pgrst, 'reload schema';
