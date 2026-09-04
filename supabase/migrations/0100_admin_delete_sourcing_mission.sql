-- ============================================================================
-- Suppression définitive d'une mission de sourcing sur mesure par un admin
-- (mission de test ou créée par erreur). Miroir des mêmes étapes de retour
-- en arrière que admin_cancel_sourcing_validation (0098) si la mission avait
-- été validée (order_id renseigné) — commande annulée, produits repassés en
-- brouillon — puis supprime réellement les lignes b2b_sourcing_items et la
-- mission elle-même (contrairement à l'annulation de validation, qui ne fait
-- que réactiver la mission).
-- ============================================================================

create or replace function public.admin_delete_sourcing_mission(p_mission_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mission record;
begin
  if not public.is_admin() then
    raise exception 'Accès refusé';
  end if;

  select * into v_mission from public.b2b_sourcing_missions where id = p_mission_id for update;
  if v_mission is null then
    raise exception 'Mission introuvable';
  end if;

  -- Mission déjà validée par le revendeur : annule la commande générée et
  -- rend les produits liés à leur état de brouillon avant de tout supprimer.
  if v_mission.order_id is not null then
    update public.orders set status = 'cancelled' where id = v_mission.order_id and status <> 'cancelled';
    update public.order_items set status = 'cancelled' where order_id = v_mission.order_id and status <> 'cancelled';

    update public.products
    set status = 'draft', reserved_by_reseller_id = null, reserved_by_order_id = null, reserved_at = null
    where reserved_by_order_id = v_mission.order_id and status = 'sold-b2b';
  end if;

  delete from public.b2b_sourcing_items where mission_id = p_mission_id;
  delete from public.b2b_sourcing_missions where id = p_mission_id;

  return jsonb_build_object('mission_id', p_mission_id);
end;
$$;

grant execute on function public.admin_delete_sourcing_mission(uuid) to authenticated;

notify pgrst, 'reload schema';
