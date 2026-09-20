-- ============================================================================
-- Refonte de la jauge de fidélité : elle ne doit JAMAIS redemander de
-- rattraper un historique — le seuil est passé de 500€/palier à 1000€/palier
-- avec le temps (0101 -> 0111), et un compte peut avoir plus de portefeuilles
-- déjà accordés que ce qu'un calcul rétroactif au barème actuel justifierait
-- (ex: 5 accordés pour 3600€ cumulés, alors que 1000€/palier n'en
-- justifierait que 3). Ces portefeuilles restent TOUS dus (gagnés sous
-- l'ancien barème, jamais repris) — mais l'ancien calcul (cumul total vs
-- loyalty_gifts_unlocked * 1000) redemandait implicitement de rattraper ce
-- delta avant de faire à nouveau progresser la jauge, ce qui la bloquait à
-- 0% pour ces comptes malgré de vraies recharges récentes.
--
-- Nouveau modèle : profiles.loyalty_progress_checkpoint retient le cumul
-- payé au moment exact où le DERNIER cadeau a été accordé. La jauge ne
-- mesure plus que ce qui a été rechargé DEPUIS ce point — jamais un
-- rattrapage de l'historique. Le backfill ci-dessous initialise ce
-- checkpoint à partir de la transaction ayant réellement déclenché le
-- dernier cadeau de chaque profil (b2b_gift_rewards.transaction_id), pas
-- d'un recalcul au barème actuel.
-- ============================================================================

alter table public.profiles add column if not exists loyalty_progress_checkpoint numeric not null default 0;

comment on column public.profiles.loyalty_progress_checkpoint is
  'Cumul de paid_amount (wallet_transactions, type=rechargement) au moment où le dernier portefeuille offert a été accordé — la jauge ne mesure la progression que depuis ce point, jamais un rattrapage de tout l''historique (voir 0150).';

with last_gift_tx as (
  select distinct on (g.profile_id) g.profile_id, wt.created_at as at
  from public.b2b_gift_rewards g
  join public.wallet_transactions wt on wt.id = g.transaction_id
  order by g.profile_id, wt.created_at desc
),
checkpoint_calc as (
  select
    lgt.profile_id,
    coalesce(sum(wt.paid_amount) filter (where wt.created_at <= lgt.at), 0) as checkpoint
  from last_gift_tx lgt
  join public.wallet_transactions wt on wt.profile_id = lgt.profile_id and wt.type = 'rechargement'
  group by lgt.profile_id
)
update public.profiles p
set loyalty_progress_checkpoint = cc.checkpoint
from checkpoint_calc cc
where p.id = cc.profile_id;

-- ----------------------------------------------------------------------------
-- credit_wallet_topup (0131) : la progression et l'octroi de nouveaux
-- cadeaux se basent désormais sur (cumul payé - checkpoint) plutôt que sur
-- floor(cumul payé / 1000) vs loyalty_gifts_unlocked — corps par ailleurs
-- identique.
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
    'amount_paid', p_amount, 'bonus', v_bonus, 'total_credited', v_total,
    'cumulative_paid', v_cumulative_paid, 'gifts_assigned', v_new_gifts
  );
end;
$$;

revoke all on function public.credit_wallet_topup(uuid, uuid, numeric, text) from public, authenticated;

notify pgrst, 'reload schema';
