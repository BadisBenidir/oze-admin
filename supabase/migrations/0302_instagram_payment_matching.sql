-- ============================================================================
-- Ventes Instagram (0300/0301) : rapprochement des virements Qonto.
-- Appelée par qonto-sync et qonto-wallet-transfers (cron chaque minute), après
-- wallet_match_transfers.
--   1. Référence OZE-IG-XXXX dans le libellé / la référence / la note ET
--      montant exact.
--   2. Secours : prénom + nom du client dans le nom du payeur, montant exact,
--      virement annoncé par le client (« J'ai fait le virement ») entre
--      30 min avant et 5 jours après l'opération, une seule commande possible.
-- Une opération ne sert qu'une fois (instagram_order_links.bank_transaction_id
-- unique + bank_transactions.matched_type).
-- ============================================================================

create or replace function public.instagram_match_transfers()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_ref text;
  v_link uuid;
  v_count int;
  v_res text;
  n int := 0;
  n_name int := 0;
  n_conflict int := 0;
begin
  if auth.uid() is not null and not public.is_admin() then raise exception 'Accès refusé'; end if;
  for r in
    select b.id, b.amount, coalesce(b.counterparty_name, b.label) payer, coalesce(b.settled_at, b.emitted_at, b.created_at) at_,
           upper(coalesce(b.raw->>'reference', '') || ' ' || coalesce(b.label, '') || ' ' || coalesce(b.raw->>'note', '')) txt
    from public.bank_transactions b
    where b.side = 'credit' and coalesce(b.qonto_status, 'completed') = 'completed'
      and b.reconciliation_status = 'unmatched' and b.matched_type is null and b.amount > 0
      and coalesce(b.settled_at, b.emitted_at, b.created_at) > now() - interval '30 days'
      and not exists (select 1 from public.wallet_transactions w where w.bank_transaction_id = b.id)
      and not exists (select 1 from public.instagram_order_links i where i.bank_transaction_id = b.id)
  loop
    v_link := null;
    -- 1. Référence.
    v_ref := (regexp_match(r.txt, 'OZ[EË][ -]*IG[ -]*([0-9]{1,6})'))[1];
    if v_ref is not null then
      select i.id into v_link
      from public.instagram_order_links i join public.orders o on o.id = i.order_id
      where i.payment_reference = 'OZE-IG-' || lpad(ltrim(v_ref, '0'), 4, '0')
        and i.paid_at is null and o.total_amount = r.amount;
    end if;

    -- 2. Nom du payeur + annonce du client.
    if v_link is null then
      select count(*), min(i.id::text)::uuid into v_count, v_link
      from public.instagram_order_links i join public.orders o on o.id = i.order_id
      where i.paid_at is null and i.cancelled_at is null and i.transfer_declared_at is not null
        and o.total_amount = r.amount
        and r.at_ > i.transfer_declared_at - interval '30 minutes'
        and r.at_ < i.transfer_declared_at + interval '5 days'
        and cardinality(public.name_tokens(o.shipping_address->>'first_name')) > 0
        and cardinality(public.name_tokens(o.shipping_address->>'last_name')) > 0
        and public.name_tokens(o.shipping_address->>'first_name') <@ public.name_tokens(r.payer)
        and public.name_tokens(o.shipping_address->>'last_name') <@ public.name_tokens(r.payer);
      if v_count <> 1 then v_link := null; end if;
      if v_link is not null then n_name := n_name + 1; end if;
    end if;

    if v_link is null then continue; end if;
    v_res := public.instagram_order_mark_paid(v_link, r.id, false);
    if v_res = 'paid' then n := n + 1; elsif v_res = 'conflict' then n_conflict := n_conflict + 1; end if;
  end loop;
  return jsonb_build_object('paid', n, 'by_name', n_name, 'conflicts', n_conflict);
end;
$$;
revoke all on function public.instagram_match_transfers() from public, anon;
grant execute on function public.instagram_match_transfers() to authenticated, service_role;

-- Compte courant d'associé : un virement portant une référence OZE-R / OZE-IG,
-- ou annoncé pour une recharge de portefeuille / une vente Instagram du même
-- montant, n'est pas un apport.
CREATE OR REPLACE FUNCTION public.associate_classify_bank_transaction(p_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  b public.bank_transactions;
  v_type text;
  v_label text;
begin
  select * into b from public.bank_transactions where id = p_id;
  if not found or b.matched_type is not null
     or exists (select 1 from public.associate_account_entries a where a.bank_transaction_id = b.id)
     or exists (select 1 from public.expenses e where e.bank_transaction_id = b.id) then
    return null;
  end if;
  v_label := upper(coalesce(b.label, ''));

  if b.side = 'debit' and v_label ~ '^BADIS BENIDIR( CA)?$' then
    v_type := 'retrait';
  elsif b.side = 'credit' and b.amount >= 100
        and (v_label in ('M. BADIS BENIDIR', 'MONSIEUR BENIDIR BADIS') or v_label like 'EI- BENIDIR BADIS%')
        and upper(coalesce(b.raw->>'reference', '') || ' ' || coalesce(b.raw->>'note', '')) !~ 'OZ[EË][ -]*(R|IG)[ -]*[0-9]'
        and not exists (select 1 from public.wallet_transfer_intents i join public.profiles p on p.id = i.profile_id
                        where i.bank_transaction_id is null and i.amount = b.amount and i.created_at > now() - interval '3 days'
                          and public.name_tokens(p.last_name) <@ public.name_tokens(b.label))
        and not exists (select 1 from public.instagram_order_links i join public.orders o on o.id = i.order_id
                        where i.paid_at is null and i.transfer_declared_at > now() - interval '5 days'
                          and o.total_amount = b.amount) then
    v_type := 'apport';
  else
    return null;
  end if;

  insert into public.associate_account_entries (entry_date, type, label, amount, bank_transaction_id, notes)
  values ((coalesce(b.settled_at, b.emitted_at, now()) at time zone 'Europe/Paris')::date, v_type,
          case when v_type = 'apport' then 'Apport en compte courant' else 'Retrait associé' end,
          b.amount, b.id, 'Qonto : ' || b.label || ' (classé automatiquement)');

  update public.bank_transactions
  set reconciliation_status = 'matched',
      matched_type = 'other',
      note = 'Compte courant d''associé : ' || case when v_type = 'apport' then 'apport' else 'retrait' end || ' (automatique)'
  where id = b.id;
  return v_type;
end;
$function$
;

-- Crons : expiration des liens (5 min) ; e-mails de facture + suivi colis (5 min,
-- seulement s'il y a du travail).
select cron.unschedule('expire-instagram-orders') where exists (select 1 from cron.job where jobname = 'expire-instagram-orders');
select cron.schedule('expire-instagram-orders', '*/5 * * * *', 'select public.expire_instagram_orders()');

select cron.unschedule('instagram-orders-followup') where exists (select 1 from cron.job where jobname = 'instagram-orders-followup');
select cron.schedule('instagram-orders-followup', '*/5 * * * *', $cron$
  select net.http_post(
    url := 'https://bmsasmqkmnlijpvoisep.supabase.co/functions/v1/instagram-order',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{"action": "cron"}'::jsonb,
    timeout_milliseconds := 60000
  )
  where exists (
    select 1 from public.instagram_order_links i join public.orders o on o.id = i.order_id
    where (i.paid_at is not null and i.invoice_emailed_at is null and i.email_attempts < 5)
       or (i.paid_at is not null and o.tracking_number is not null and o.status not in ('delivered', 'cancelled')
           and (i.tracking_checked_at is null or i.tracking_checked_at < now() - interval '2 hours'))
  );
$cron$);

notify pgrst, 'reload schema';
