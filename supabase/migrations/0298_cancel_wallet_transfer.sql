-- Rechargement par virement : le membre annule son annonce (« Annuler » à
-- côté de « En attente du virement… ») quand il n'a finalement pas viré.
create or replace function public.cancel_wallet_transfer_intents()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if auth.uid() is null then raise exception 'Non authentifié'; end if;
  delete from public.wallet_transfer_intents where profile_id = auth.uid() and bank_transaction_id is null;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.cancel_wallet_transfer_intents() from public, anon;
grant execute on function public.cancel_wallet_transfer_intents() to authenticated;
