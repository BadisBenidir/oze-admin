-- ============================================================================
-- reseller_validate_sourcing_mission facturait chaque pièce au prorata de
-- son cost_price sur advance_amount (le montant total ne pouvait jamais
-- bouger, seule sa répartition entre pièces variait) — ça ignorait
-- totalement custom_reseller_price (0152), l'admin pouvait éditer un prix
-- dans la modale sans que ça n'affecte jamais la vraie commande générée à
-- la validation.
--
-- Nouveau calcul par pièce : coalesce(custom_reseller_price, floor(cost_price
-- * (1 + marge%))) — exactement le "prix effectif" déjà affiché dans
-- SourcingMissionDetailModal.tsx et exposé au revendeur via
-- reseller_sourcing_items.unit_price (0151/0152), la même valeur partout.
-- Le total de la commande devient la somme de ces prix effectifs, qui peut
-- désormais différer de advance_amount (l'avance déjà encaissée à la
-- création de la mission) si l'admin a modifié des prix depuis — ce
-- montant continue d'être marqué 'paid' comme avant (aucune commande
-- Stripe/portefeuille supplémentaire n'est déclenchée ici), donc un écart
-- doit être régularisé manuellement par l'admin si besoin (pas de
-- réconciliation automatique de paiement dans cette migration).
-- ============================================================================

create or replace function public.reseller_validate_sourcing_mission(p_mission_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mission record;
  v_reseller_email text;
  v_order_id uuid;
  v_item_count integer;
  v_margin_rate numeric;
  v_total_billed numeric;
begin
  if not public.reseller_can_transact() then
    raise exception 'Accès découverte : validation de mission non autorisée sur ce compte';
  end if;

  select * into v_mission from public.b2b_sourcing_missions where id = p_mission_id for update;
  if v_mission is null then
    raise exception 'Mission introuvable';
  end if;

  if v_mission.user_id is distinct from auth.uid() then
    raise exception 'Accès refusé';
  end if;

  if v_mission.status <> 'active' then
    raise exception 'Cette mission n''est plus en cours de sélection';
  end if;
  if not v_mission.is_published_to_reseller then
    raise exception 'Cette mission n''est pas encore prête à être validée';
  end if;

  v_margin_rate := case when v_mission.advance_amount > 0
    then (v_mission.advance_amount - v_mission.allocated_cost_budget) / v_mission.advance_amount
    else null
  end;

  create temporary table tmp_sourcing_alloc (
    item_id uuid primary key,
    product_id uuid,
    cost_price numeric,
    custom_reseller_price numeric,
    alloc numeric
  ) on commit drop;

  insert into tmp_sourcing_alloc (item_id, product_id, cost_price, custom_reseller_price)
  select i.id, i.product_id, i.cost_price, i.custom_reseller_price
  from public.b2b_sourcing_items i
  where i.mission_id = p_mission_id and i.status <> 'cancelled';

  select count(*) into v_item_count from tmp_sourcing_alloc;
  if v_item_count = 0 then
    raise exception 'Aucune pièce à valider sur cette mission';
  end if;

  if exists (select 1 from tmp_sourcing_alloc where product_id is null) then
    raise exception 'Certaines pièces ne sont pas encore finalisées par notre équipe — contactez-nous avant de valider';
  end if;

  perform 1 from public.products p join tmp_sourcing_alloc t on t.product_id = p.id for update;

  if exists (
    select 1 from tmp_sourcing_alloc t join public.products p on p.id = t.product_id
    where p.status not in ('draft', 'sourced-b2b')
  ) then
    raise exception 'Certaines pièces ne sont plus disponibles — contactez notre équipe';
  end if;

  -- Prix effectif = celui imposé manuellement, sinon le calcul automatique
  -- (même règle que SourcingMissionDetailModal.tsx / reseller_sourcing_
  -- items.unit_price). Bloque plutôt que de facturer 0 € si ni l'un ni
  -- l'autre n'est disponible (cost_price manquant et pas de prix imposé) —
  -- ne devrait jamais arriver pour une pièce déjà liée à un produit, mais
  -- jamais silencieusement à moitié gratuit si ça arrivait quand même.
  update tmp_sourcing_alloc
  set alloc = coalesce(custom_reseller_price, case when cost_price is not null and v_margin_rate is not null then floor(cost_price * (1 + v_margin_rate)) else null end);

  if exists (select 1 from tmp_sourcing_alloc where alloc is null) then
    raise exception 'Le prix de certaines pièces n''a pas pu être déterminé — contactez notre équipe';
  end if;

  select coalesce(sum(alloc), 0) into v_total_billed from tmp_sourcing_alloc;

  select contact_email into v_reseller_email from public.resellers where id = v_mission.reseller_id;

  insert into public.orders (
    order_number, email, status, total_amount, subtotal, shipping_cost, currency,
    payment_status, reseller_id, placed_by_profile_id,
    order_channel, approval_status, approved_at
  ) values (
    v_mission.reference, v_reseller_email, 'confirmed', v_total_billed, v_total_billed, 0, 'EUR',
    'paid', v_mission.reseller_id, v_mission.user_id,
    'b2b', 'approved', now()
  )
  returning id into v_order_id;

  insert into public.order_items (order_id, product_id, quantity, unit_price, line_total, product_snapshot)
  select v_order_id, p.id, 1, t.alloc, t.alloc, to_jsonb(p.*)
  from tmp_sourcing_alloc t
  join public.products p on p.id = t.product_id;

  update public.products p
  set status = 'sold-b2b', reserved_by_reseller_id = v_mission.reseller_id, reserved_by_order_id = v_order_id, reserved_at = now()
  from tmp_sourcing_alloc t
  where p.id = t.product_id;

  update public.b2b_sourcing_items
  set status = 'validated'
  where mission_id = p_mission_id and status <> 'cancelled';

  update public.b2b_sourcing_missions
  set status = 'completed', order_id = v_order_id
  where id = p_mission_id;

  return jsonb_build_object('order_id', v_order_id, 'order_number', v_mission.reference, 'total_billed', v_total_billed);
end;
$$;

grant execute on function public.reseller_validate_sourcing_mission(uuid) to authenticated;

notify pgrst, 'reload schema';
