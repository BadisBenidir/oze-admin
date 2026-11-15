-- ============================================================================
-- Rechargement par virement (0295) : sécurisation des annonces.
--
-- Incident du 15/11/2026 : trois clics sur « J'ai fait mon virement » ont
-- créé trois annonces de 1 €, chacune rapprochée d'un ANCIEN virement de 1 €
-- non annoncé (envoyés plus tôt dans la journée). Aucun virement crédité deux
-- fois (index unique), mais une annonce ne doit jamais aller chercher un
-- virement antérieur (paiement de facture, de sourcing…).
--   - une annonce ne vaut que pour un virement reçu au plus 30 min AVANT
--     l'annonce (virement instantané fait juste avant le clic) ou après ;
--   - pas de nouvelle annonce du même montant si une annonce est ouverte ou
--     a été utilisée il y a moins de 10 min (clics répétés).
-- ============================================================================

create or replace function public.declare_wallet_transfer(p_amount numeric)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_amount numeric := round(p_amount, 2);
begin
  if auth.uid() is null then raise exception 'Non authentifié'; end if;
  if v_amount is null or v_amount <= 0 or v_amount > 100000 then raise exception 'Montant invalide'; end if;
  select id into v_id from public.wallet_transfer_intents
  where profile_id = auth.uid() and amount = v_amount
    and ((bank_transaction_id is null and created_at > now() - interval '3 days')
         or (bank_transaction_id is not null and created_at > now() - interval '10 minutes'))
  order by created_at desc limit 1;
  if v_id is null then
    insert into public.wallet_transfer_intents (profile_id, amount) values (auth.uid(), v_amount) returning id into v_id;
  end if;
  return v_id;
end;
$$;

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
  v_intent uuid;
  v_count int;
  n int := 0;
  n_name int := 0;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'Accès refusé';
  end if;
  for r in
    select b.id, b.amount, b.label, coalesce(b.settled_at, b.emitted_at) at_,
           upper(coalesce(b.raw->>'reference', '') || ' ' || coalesce(b.label, '') || ' ' || coalesce(b.raw->>'note', '')) txt
    from public.bank_transactions b
    where b.side = 'credit' and coalesce(b.qonto_status, 'completed') = 'completed'
      and b.reconciliation_status = 'unmatched' and b.amount > 0
      and not exists (select 1 from public.wallet_transactions w where w.bank_transaction_id = b.id)
  loop
    -- 1. Référence dans le libellé : « OZE-R-0042 », « OZE R 0042 », « OZER0042 »…
    v_profile := null;
    v_ref := (regexp_match(r.txt, 'OZ[EË][ -]*R[ -]*([0-9]{1,6})'))[1];
    if v_ref is not null then
      select id into v_profile from public.profiles where wallet_transfer_reference = 'OZE-R-' || lpad(ltrim(v_ref, '0'), 4, '0');
    end if;

    -- 2. Sinon : nom du payeur + virement annoncé du même montant (< 3 jours).
    if v_profile is null and coalesce(r.at_, now()) > now() - interval '7 days' then
      select count(*), min(i.profile_id::text)::uuid, min(i.id::text)::uuid into v_count, v_profile, v_intent
      from public.wallet_transfer_intents i
      join public.profiles p on p.id = i.profile_id
      where i.bank_transaction_id is null
        and i.amount = r.amount
        -- virement reçu au plus 30 min avant l'annonce, ou après (3 jours max)
        and coalesce(r.at_, now()) >= i.created_at - interval '30 minutes'
        and coalesce(r.at_, now()) <= i.created_at + interval '3 days'
        and cardinality(public.name_tokens(p.first_name)) > 0
        and cardinality(public.name_tokens(p.last_name)) > 0
        and public.name_tokens(p.first_name) <@ public.name_tokens(r.label)
        and public.name_tokens(p.last_name) <@ public.name_tokens(r.label);
      if v_count <> 1 then v_profile := null; end if;
      if v_profile is not null then n_name := n_name + 1; end if;
    end if;

    if v_profile is null then continue; end if;   -- à attribuer à la main
    perform public.credit_wallet_transfer(r.id, v_profile);
    update public.wallet_transfer_intents set bank_transaction_id = r.id
    where id = coalesce(v_intent, (select id from public.wallet_transfer_intents
                                   where profile_id = v_profile and amount = r.amount and bank_transaction_id is null
                                   order by created_at desc limit 1));
    v_intent := null;
    n := n + 1;
  end loop;
  return jsonb_build_object('credited', n, 'by_name', n_name);
end;
$$;
revoke all on function public.wallet_match_transfers() from public, anon;
grant execute on function public.wallet_match_transfers() to authenticated, service_role;

notify pgrst, 'reload schema';
