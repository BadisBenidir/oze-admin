-- ============================================================================
-- Blocage automatique des revendeurs en défaut de paiement d'enchère (> 24h).
--
-- Un revendeur qui a remporté un lot a jusqu'à auction_items.payment_deadline
-- (24h après adjudication, 0137) pour le régler — à défaut d'échéance, 24h
-- après la création de la commande AUC-. Passé ce délai, tant que le lot
-- n'est ni payé ni annulé par l'admin, il ne peut plus :
--   - enchérir (trigger sur auction_bids, ci-dessous : couvre place_auto_bid
--     et toute insertion directe) ;
--   - passer commande au catalogue (contrôle can_user_purchase() dans
--     l'Edge Function b2b-checkout, AVANT tout débit de solde ou paiement
--     Stripe — un blocage au niveau de orders serait trop tard pour la carte,
--     le webhook crée la commande après encaissement).
-- Payer le lot en retard (pay_auction_order_with_wallet /
-- auction-order-payment) et recharger son solde restent évidemment permis.
--
-- Aucun flag stocké : le statut est recalculé à chaque appel, donc la
-- restriction tombe dès que le lot est payé ou annulé (0156), sans action.
-- Même critère que get_my_pending_auction_payments (0156), plus l'échéance.
-- ============================================================================

create or replace function public.has_overdue_auction_payment(p_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.auction_items ai
    join public.orders o on o.id = ai.order_id
    where ai.current_winner_id = p_user_id
      and ai.status = 'sold'
      and o.payment_status = 'pending'
      and o.status <> 'cancelled'
      and coalesce(ai.payment_deadline, o.created_at + interval '24 hours') < now()
  );
$$;

revoke all on function public.has_overdue_auction_payment(uuid) from public, anon, authenticated;

-- Point d'entrée appelable : un revendeur ne peut interroger que son propre
-- statut, l'admin (ou le service role, auth.uid() NULL) celui de n'importe qui.
create or replace function public.can_user_purchase(p_user_id uuid default auth.uid())
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if p_user_id is null then
    return false;
  end if;
  if auth.uid() is not null and p_user_id <> auth.uid() and not public.is_admin() then
    raise exception 'Non autorisé';
  end if;
  return not public.has_overdue_auction_payment(p_user_id);
end;
$$;

revoke all on function public.can_user_purchase(uuid) from public, anon;
grant execute on function public.can_user_purchase(uuid) to authenticated, service_role;

create or replace function public.auction_bids_block_overdue_payers()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.has_overdue_auction_payment(new.user_id) then
    raise exception 'Votre compte est temporairement restreint : vous avez un lot remporté non payé depuis plus de 24h. Veuillez régulariser votre situation pour participer à nouveau.';
  end if;
  return new;
end;
$$;

drop trigger if exists auction_bids_block_overdue_payers on public.auction_bids;
create trigger auction_bids_block_overdue_payers
  before insert on public.auction_bids
  for each row execute function public.auction_bids_block_overdue_payers();

notify pgrst, 'reload schema';
