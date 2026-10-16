-- ============================================================================
-- Message « Vous avez reçu un crédit » dans l'espace membre.
--
-- Quand l'admin crédite le solde d'un membre (Ajuster le solde → Créditer,
-- wallet_transactions.type = 'ajustement_admin', montant > 0, avec une note),
-- le membre voit à sa prochaine visite un message avec le montant et la
-- note. acknowledged_at = moment où il l'a fermé (null = pas encore vu).
-- Les crédits antérieurs à cette migration ne sont pas ré-annoncés, sauf
-- ceux des dernières 48 h.
-- ============================================================================

alter table public.wallet_transactions add column if not exists acknowledged_at timestamptz;

update public.wallet_transactions
set acknowledged_at = now()
where type = 'ajustement_admin'
  and acknowledged_at is null
  and created_at < now() - interval '48 hours';

-- Le membre marque comme vus SES crédits (jamais ceux d'un autre).
create or replace function public.acknowledge_wallet_credits(p_transaction_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'Non authentifié';
  end if;

  update public.wallet_transactions
  set acknowledged_at = now()
  where id = any(p_transaction_ids)
    and profile_id = auth.uid()
    and acknowledged_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.acknowledge_wallet_credits(uuid[]) from public, anon;
grant execute on function public.acknowledge_wallet_credits(uuid[]) to authenticated;

notify pgrst, 'reload schema';
