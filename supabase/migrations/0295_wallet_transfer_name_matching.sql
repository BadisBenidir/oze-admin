-- ============================================================================
-- Rechargement par virement (0292) : reconnaissance par le NOM du payeur
-- quand le libellé ne contient pas la référence (beaucoup de banques perdent
-- ou tronquent le motif).
--
-- Garde-fou : les membres paient aussi par virement leurs sourcings et leurs
-- factures — un simple nom ne suffit donc pas. Le membre ANNONCE son
-- virement sur sa page Portefeuille (montant + « J'ai fait mon virement ») :
-- wallet_transfer_intents. Un virement sans référence est crédité
-- automatiquement seulement si :
--   - le nom du payeur contient le prénom ET le nom du membre ;
--   - ce membre a une annonce ouverte de moins de 3 jours du MÊME montant ;
--   - un seul membre correspond (sinon : à attribuer à la main).
-- Les virements de Badis annoncés ainsi ne sont plus classés en apport en
-- compte courant (0283).
-- ============================================================================

create table if not exists public.wallet_transfer_intents (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  amount numeric(10, 2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  bank_transaction_id uuid references public.bank_transactions(id)
);
create index if not exists wallet_transfer_intents_open_idx on public.wallet_transfer_intents (profile_id) where bank_transaction_id is null;

alter table public.wallet_transfer_intents enable row level security;
drop policy if exists wallet_transfer_intents_read on public.wallet_transfer_intents;
create policy wallet_transfer_intents_read on public.wallet_transfer_intents for select to authenticated
  using (profile_id = auth.uid() or public.is_admin());

-- Le membre annonce son virement (une annonce ouverte par montant).
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
  where profile_id = auth.uid() and amount = v_amount and bank_transaction_id is null and created_at > now() - interval '3 days';
  if v_id is null then
    insert into public.wallet_transfer_intents (profile_id, amount) values (auth.uid(), v_amount) returning id into v_id;
  end if;
  return v_id;
end;
$$;
revoke all on function public.declare_wallet_transfer(numeric) from public, anon;
grant execute on function public.declare_wallet_transfer(numeric) to authenticated;

-- Mots d'un nom, sans accents ni civilité.
create or replace function public.name_tokens(p text)
returns text[]
language sql
immutable
as $$
  select coalesce(array_agg(t), '{}')
  from unnest(regexp_split_to_array(
         lower(translate(coalesce(p, ''), 'ÀÂÄÁÃÇÉÈÊËÍÎÏÌÑÓÔÖÒÕÚÛÜÙÝàâäáãçéèêëíîïìñóôöòõúûüùý', 'AAAAACEEEEIIIINOOOOOUUUUYaaaaaceeeeiiiinooooouuuuy')),
         '[^a-z0-9]+')) t
  where length(t) > 1 and t not in ('m', 'mr', 'mme', 'mlle', 'monsieur', 'madame', 'ei', 'sas', 'sarl', 'eurl', 'sasu');
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
        and i.created_at > coalesce(r.at_, now()) - interval '3 days'
        and i.created_at < coalesce(r.at_, now()) + interval '1 day'
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


-- Compte courant d'associé : un virement de Badis annoncé comme recharge de
-- portefeuille (même montant, < 3 jours) n'est pas un apport.
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
        and upper(coalesce(b.raw->>'reference', '') || ' ' || coalesce(b.raw->>'note', '')) !~ 'OZ[EË][ -]*R[ -]*[0-9]'
        and not exists (select 1 from public.wallet_transfer_intents i join public.profiles p on p.id = i.profile_id
                        where i.bank_transaction_id is null and i.amount = b.amount and i.created_at > now() - interval '3 days'
                          and public.name_tokens(p.last_name) <@ public.name_tokens(b.label)) then
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

notify pgrst, 'reload schema';
