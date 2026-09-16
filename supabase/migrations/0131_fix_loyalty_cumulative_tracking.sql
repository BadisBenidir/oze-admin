-- ============================================================================
-- Corrige la jauge de fidélité B2B ("X € / 1000 € rechargés") qui ne bougeait
-- plus pour aucun revendeur depuis la migration 0111.
--
-- Root cause : 0111 a réécrit credit_wallet_topup (introduite par 0101) pour
-- changer le barème (500 €→1000 €/palier) mais son INSERT vers
-- wallet_transactions a PERDU la colonne paid_amount — ajoutée par 0040
-- justement pour ce calcul. Résultat : toute recharge faite depuis 0111 a
-- paid_amount = NULL, et useWallet.ts (qui fait SUM(paid_amount) pour
-- afficher la jauge, voir loyaltyProgress) ne comptait donc plus RIEN pour
-- ces recharges — la jauge restait figée à sa valeur d'avant 0111 quel que
-- soit le montant réellement rechargé depuis.
--
-- Deuxième problème, plus profond : depuis 0101/0111, le cadeau
-- (b2b_gift_rewards) n'a jamais été cumulatif — il ne se déclenchait QUE
-- si UNE SEULE recharge atteignait 1000 € d'un coup (floor(p_amount/1000)),
-- jamais en additionnant plusieurs petites recharges. Cette migration
-- restaure un calcul cumulatif (comme l'annonce le texte affiché au
-- revendeur : "tous les 1000 € rechargés"), tout en gardant b2b_gift_rewards
-- comme table de suivi (pas de retour à l'ancien système loyalty_gifts/
-- statut produit 'cadeau' de 0040, remplacé depuis par b2b_gift_rewards et
-- son écran admin "Portefeuilles offerts").
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Backfill : reconstruit paid_amount pour toutes les recharges faites
-- depuis 0111 (actuellement NULL) — même technique que le backfill de 0101 :
-- le montant payé se lit dans le libellé si un bonus a été appliqué, sinon
-- `amount` est déjà le montant payé (aucun bonus n'a modifié la valeur).
-- ----------------------------------------------------------------------------
update public.wallet_transactions wt
set paid_amount = coalesce((regexp_match(wt.note, 'Recharge Stripe \(\+([\d.]+) €\)'))[1]::numeric, wt.amount)
where wt.type = 'rechargement' and wt.paid_amount is null;

-- ----------------------------------------------------------------------------
-- 2. Initialise profiles.loyalty_gifts_unlocked (colonne 0040, plus jamais
-- écrite depuis 0111) à partir des portefeuilles DÉJÀ accordés dans
-- b2b_gift_rewards — jamais recalculé depuis le cumul brut, pour ne jamais
-- récompenser deux fois un palier déjà couvert par un ancien calcul par
-- recharge individuelle. Un profil dont le cumul réel a déjà dépassé un
-- palier sans qu'aucune recharge individuelle n'ait atteint 1000 €
-- (plusieurs petites recharges) se rattrape automatiquement, sans doublon,
-- dès sa prochaine recharge (voir credit_wallet_topup ci-dessous).
-- ----------------------------------------------------------------------------
update public.profiles p
set loyalty_gifts_unlocked = coalesce((
  select sum(g.quantity)::int from public.b2b_gift_rewards g where g.profile_id = p.id
), 0)
where exists (select 1 from public.b2b_gift_rewards g where g.profile_id = p.id);

-- ----------------------------------------------------------------------------
-- 3. credit_wallet_topup : restaure paid_amount à l'insert, et calcule le
-- cadeau sur le cumul PAYÉ du profil (jamais partagé entre contacts d'une
-- même société, voir useWallet.ts) plutôt que sur cette seule recharge.
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
  v_cumulative_paid numeric;
  v_target_tiers integer;
  v_current_tiers integer;
  v_new_gifts integer;
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

  insert into public.wallet_transactions (profile_id, reseller_id, amount, type, status, stripe_session_id, note, paid_amount)
  values (p_profile_id, p_reseller_id, v_total, 'rechargement', 'success', p_stripe_session_id, v_note, p_amount)
  returning id into v_existing_id;

  -- Portefeuilles offerts : cumul PAYÉ de CE profil (pas juste cette
  -- recharge) — 1 portefeuille tous les 1000 € cumulés, potentiellement
  -- plusieurs d'un coup si une recharge fait franchir plusieurs paliers.
  -- loyalty_gifts_unlocked retient les paliers déjà récompensés pour ne
  -- jamais compter deux fois le même palier.
  select coalesce(sum(paid_amount), 0) into v_cumulative_paid
  from public.wallet_transactions
  where profile_id = p_profile_id and type = 'rechargement';

  v_target_tiers := floor(v_cumulative_paid / 1000);

  select loyalty_gifts_unlocked into v_current_tiers from public.profiles where id = p_profile_id for update;

  v_new_gifts := greatest(v_target_tiers - v_current_tiers, 0);

  if v_new_gifts > 0 then
    insert into public.b2b_gift_rewards (reseller_id, profile_id, transaction_id, recharge_amount, quantity, status)
    values (p_reseller_id, p_profile_id, v_existing_id, p_amount, v_new_gifts, 'pending');

    update public.profiles set loyalty_gifts_unlocked = v_target_tiers where id = p_profile_id;
  end if;

  return jsonb_build_object(
    'already_processed', false, 'transaction_id', v_existing_id,
    'amount_paid', p_amount, 'bonus', v_bonus, 'total_credited', v_total,
    'cumulative_paid', v_cumulative_paid, 'gifts_assigned', v_new_gifts
  );
end;
$$;

revoke all on function public.credit_wallet_topup(uuid, uuid, numeric, text) from public, authenticated;

notify pgrst, 'reload schema';
