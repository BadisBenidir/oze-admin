-- Rechargement par virement (0296) : la règle « pas de nouvelle annonce du
-- même montant moins de 10 min après une annonce utilisée » bloquait un vrai
-- nouveau virement du même montant (test du 15/11/2026, 18 h 17). Retirée :
-- un virement déjà crédité ne peut plus l'être (index unique) et une annonce
-- ne rapproche que des virements reçus au plus 30 min avant elle. Seule une
-- annonce OUVERTE du même montant est réutilisée (clics répétés).

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
  where profile_id = auth.uid() and amount = v_amount and bank_transaction_id is null and created_at > now() - interval '3 days'
  order by created_at desc limit 1;
  if v_id is null then
    insert into public.wallet_transfer_intents (profile_id, amount) values (auth.uid(), v_amount) returning id into v_id;
  end if;
  return v_id;
end;
$$;
