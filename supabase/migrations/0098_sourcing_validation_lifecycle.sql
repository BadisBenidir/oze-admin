-- ============================================================================
-- Cycle de vie de la validation d'une mission de sourcing sur mesure.
--
-- Jusqu'ici, la mission ne servait qu'à suivre un budget : aucune commande
-- réelle n'était jamais créée, et les pièces sourcées ne rejoignaient jamais
-- le circuit d'expédition (order_items / "Prêts à expédier"). Ce correctif
-- ajoute :
--   1. reseller_validate_sourcing_mission(mission_id) — déclenché par le
--      REVENDEUR (nouveau bouton "Valider ma sélection", portail pro) :
--      crée une vraie commande B2B (orders/order_items) dont le total est
--      réparti au prorata du cost_price de chaque pièce, de sorte que
--      total_amount == advance_amount déjà encaissée (pas de nouvelle
--      saisie de prix). Bascule les produits liés en 'sold-b2b'. Bloque si
--      une pièce "à la volée" n'a pas encore de fiche produit liée
--      (product_id) : ces pièces n'ont ni marque ni catégorie réelles, et ce
--      repo ne crée jamais de ligne brands/categories par code — seul un
--      admin, via le formulaire produit existant, peut les fournir.
--   2. admin_cancel_sourcing_validation(mission_id) — déclenché par
--      l'ADMIN : annule symétriquement tout ce que (1) a fait (commande
--      annulée, produits repassés en brouillon, mission réactivée), sans
--      toucher aux lignes b2b_sourcing_items (elles restent associées,
--      juste repassées au statut 'sourced').
--
-- Anti double-comptage du CA : useB2BRevenue.ts ajoutait déjà
-- advance_amount pour toute mission payée non annulée. Une fois une vraie
-- commande créée (order_id renseigné), son total (== advance_amount, par
-- construction ci-dessus) est déjà compté via b2b_order_item_revenue — le
-- calcul côté client est donc changé pour n'ajouter advance_amount QUE tant
-- qu'aucune commande n'est encore liée (order_id is null), voir
-- useB2BRevenue.ts.
-- ============================================================================

alter table public.b2b_sourcing_missions
  add column if not exists order_id uuid references public.orders (id) on delete set null;

create index if not exists b2b_sourcing_missions_order_id_idx on public.b2b_sourcing_missions (order_id);

-- ----------------------------------------------------------------------------
-- Validation côté revendeur.
-- ----------------------------------------------------------------------------
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
  v_total_cost numeric;
  v_remainder numeric;
  v_first_item_id uuid;
begin
  select * into v_mission from public.b2b_sourcing_missions where id = p_mission_id for update;
  if v_mission is null then
    raise exception 'Mission introuvable';
  end if;

  -- Même règle de propriété que reseller_sourcing_items (0097) : le
  -- revendeur ou le sous-compte demandeur précis.
  if not (v_mission.reseller_id = public.current_reseller_id() or v_mission.user_id = auth.uid()) then
    raise exception 'Accès refusé';
  end if;

  if v_mission.status <> 'active' then
    raise exception 'Cette mission n''est plus en cours de sélection';
  end if;
  if not v_mission.is_published_to_reseller then
    raise exception 'Cette mission n''est pas encore prête à être validée';
  end if;

  create temporary table tmp_sourcing_alloc (
    item_id uuid primary key,
    product_id uuid,
    cost_price numeric,
    alloc numeric
  ) on commit drop;

  insert into tmp_sourcing_alloc (item_id, product_id, cost_price)
  select i.id, i.product_id, coalesce(i.cost_price, 0)
  from public.b2b_sourcing_items i
  where i.mission_id = p_mission_id and i.status <> 'cancelled';

  select count(*) into v_item_count from tmp_sourcing_alloc;
  if v_item_count = 0 then
    raise exception 'Aucune pièce à valider sur cette mission';
  end if;

  if exists (select 1 from tmp_sourcing_alloc where product_id is null) then
    raise exception 'Certaines pièces ne sont pas encore finalisées par notre équipe — contactez-nous avant de valider';
  end if;

  -- Verrouille les produits concernés pour la durée de la transaction :
  -- empêche une vente concurrente du même produit ailleurs pendant la
  -- validation.
  perform 1 from public.products p join tmp_sourcing_alloc t on t.product_id = p.id for update;

  if exists (
    select 1 from tmp_sourcing_alloc t join public.products p on p.id = t.product_id where p.status <> 'draft'
  ) then
    raise exception 'Certaines pièces ne sont plus disponibles — contactez notre équipe';
  end if;

  select coalesce(sum(cost_price), 0) into v_total_cost from tmp_sourcing_alloc;

  if v_total_cost > 0 then
    update tmp_sourcing_alloc set alloc = round(v_mission.advance_amount * cost_price / v_total_cost, 2);
  else
    update tmp_sourcing_alloc set alloc = round(v_mission.advance_amount / v_item_count, 2);
  end if;

  -- Ajuste l'arrondi sur une pièce (déterministe) pour que la somme des
  -- lignes soit exactement égale à l'avance déjà encaissée.
  select v_mission.advance_amount - coalesce(sum(alloc), 0) into v_remainder from tmp_sourcing_alloc;
  select item_id into v_first_item_id from tmp_sourcing_alloc order by item_id limit 1;
  update tmp_sourcing_alloc set alloc = alloc + v_remainder where item_id = v_first_item_id;

  select contact_email into v_reseller_email from public.resellers where id = v_mission.reseller_id;

  insert into public.orders (
    order_number, email, status, total_amount, subtotal, shipping_cost, currency,
    payment_status, reseller_id, placed_by_profile_id,
    order_channel, approval_status, approved_at
  ) values (
    v_mission.reference, v_reseller_email, 'confirmed', v_mission.advance_amount, v_mission.advance_amount, 0, 'EUR',
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

  return jsonb_build_object('order_id', v_order_id, 'order_number', v_mission.reference);
end;
$$;

grant execute on function public.reseller_validate_sourcing_mission(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Annulation de la validation côté admin — miroir exact de (1).
-- ----------------------------------------------------------------------------
create or replace function public.admin_cancel_sourcing_validation(p_mission_id uuid)
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
  if v_mission.status <> 'completed' or v_mission.order_id is null then
    raise exception 'Aucune validation à annuler pour cette mission';
  end if;

  update public.orders set status = 'cancelled' where id = v_mission.order_id and status <> 'cancelled';
  update public.order_items set status = 'cancelled' where order_id = v_mission.order_id and status <> 'cancelled';

  update public.products
  set status = 'draft', reserved_by_reseller_id = null, reserved_by_order_id = null, reserved_at = null
  where reserved_by_order_id = v_mission.order_id and status = 'sold-b2b';

  update public.b2b_sourcing_items
  set status = 'sourced'
  where mission_id = p_mission_id and status = 'validated';

  update public.b2b_sourcing_missions
  set status = 'active', order_id = null
  where id = p_mission_id;

  return jsonb_build_object('mission_id', p_mission_id, 'reverted_order_id', v_mission.order_id);
end;
$$;

grant execute on function public.admin_cancel_sourcing_validation(uuid) to authenticated;

notify pgrst, 'reload schema';
