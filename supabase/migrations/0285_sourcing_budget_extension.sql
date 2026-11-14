-- Sourcing sur mesure : « allonge de budget ».
--
-- Le revendeur rallonge le budget d'une mission en cours : l'avance
-- (advance_amount) augmente du montant de l'allonge, et l'enveloppe d'achat
-- (allocated_cost_budget) augmente dans la MÊME proportion, pour garder le
-- même pourcentage de marge. Le barème des prix revendeur
-- ((advance - enveloppe) / advance, voir SourcingMissionDetailModal) reste
-- donc inchangé et le prix des pièces déjà sourcées ne bouge pas.
-- L'allonge se facture ensuite comme une facture d'avance de plus (0220 :
-- « reste à facturer » = advance_amount - déjà facturé).
-- paid_at (avance « encaissée ») ne bouge pas : la compta compte
-- l'encaissé réel via paid_amount (somme des factures d'avance payées).
-- Historique des allonges : budget_extensions (jsonb).

alter table public.b2b_sourcing_missions
  add column if not exists budget_extensions jsonb not null default '[]'::jsonb;

create or replace function public.extend_sourcing_mission_budget(p_mission_id uuid, p_amount numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mission record;
  v_amount numeric := round(p_amount, 2);
  v_cost_added numeric;
begin
  if not public.is_admin() then
    raise exception 'Accès refusé : réservé aux administrateurs';
  end if;
  if v_amount is null or v_amount <= 0 then
    raise exception 'Montant de l''allonge invalide';
  end if;

  select * into v_mission from public.b2b_sourcing_missions where id = p_mission_id for update;
  if not found then
    raise exception 'Mission de sourcing introuvable';
  end if;
  if v_mission.status <> 'active' then
    raise exception 'Seule une mission en cours peut recevoir une allonge de budget';
  end if;
  if coalesce(v_mission.advance_amount, 0) <= 0 then
    raise exception 'Budget de la mission manquant';
  end if;

  v_cost_added := round(v_amount * v_mission.allocated_cost_budget / v_mission.advance_amount, 2);

  update public.b2b_sourcing_missions
  set advance_amount = advance_amount + v_amount,
      allocated_cost_budget = allocated_cost_budget + v_cost_added,
      budget_extensions = budget_extensions || jsonb_build_array(jsonb_build_object(
        'amount', v_amount,
        'cost_budget_added', v_cost_added,
        'previous_advance', v_mission.advance_amount,
        'at', now(),
        'by', auth.uid()
      ))
  where id = p_mission_id;

  return jsonb_build_object(
    'amount', v_amount,
    'cost_budget_added', v_cost_added,
    'advance_amount', v_mission.advance_amount + v_amount,
    'allocated_cost_budget', v_mission.allocated_cost_budget + v_cost_added
  );
end;
$$;

revoke all on function public.extend_sourcing_mission_budget(uuid, numeric) from public, anon;
grant execute on function public.extend_sourcing_mission_budget(uuid, numeric) to authenticated;

notify pgrst, 'reload schema';
