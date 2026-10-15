-- ============================================================================
-- Préparation des colis : case « Dans le carton » par article.
--
-- Pendant la préparation d'une demande de livraison, l'admin coche chaque
-- article au moment où il le met dans le carton (ParcelSplitEditor) — pour
-- ne rien oublier avant de générer le bordereau. packed_at = moment du
-- cochage (null = pas encore emballé). Purement indicatif : aucun effet sur
-- fulfillment_status ni sur l'expédition.
-- ============================================================================

alter table public.order_items add column if not exists packed_at timestamptz;

create or replace function public.admin_set_items_packed(p_item_ids uuid[], p_packed boolean)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if not public.is_admin() then
    raise exception 'Accès refusé : réservé aux administrateurs';
  end if;

  update public.order_items
  set packed_at = case when p_packed then coalesce(packed_at, now()) else null end
  where id = any(p_item_ids);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.admin_set_items_packed(uuid[], boolean) from public, anon;
grant execute on function public.admin_set_items_packed(uuid[], boolean) to authenticated;

notify pgrst, 'reload schema';
