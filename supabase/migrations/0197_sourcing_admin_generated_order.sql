-- ============================================================================
-- Missions de sourcing clôturées par l'admin : génération de la commande.
--
-- Jusqu'ici, « Clôturer la mission » (admin) passait seulement la mission en
-- 'completed', SANS commande (seule la validation par le membre,
-- reseller_validate_sourcing_mission, en créait une). Conséquence : aucune
-- pièce ne pouvait passer en réception / « prêt à la livraison », le membre
-- ne pouvait pas demander sa livraison, et la fiche produit n'avait aucun
-- détail de vente.
--
-- admin_generate_sourcing_order crée cette commande — à la clôture, ou après
-- coup pour une mission déjà clôturée sans commande :
--   - total = l'avance (le membre verse toujours la totalité d'avance) ;
--     répartie entre les pièces au prorata de leur coût d'achat, l'arrondi
--     sur la dernière — le CA des missions déjà clôturées ne bouge pas
--     (useAccountingRawData les comptait déjà pour advance_amount) ;
--   - date de commande = date de clôture (completed_at) : même mois de CA ;
--   - commande payée (l'avance est déjà encaissée), articles 'ordered' →
--     chaîne de réception habituelle.
-- order_generated_by_admin marque ces commandes : l'avance est déjà la vente
-- de la mission, generate_invoice_for_order n'en émet jamais une seconde
-- facture (sauf facture d'avance existante, rattachée comme en 0196).
-- ============================================================================

alter table public.b2b_sourcing_missions
  add column if not exists order_generated_by_admin boolean not null default false;

create or replace function public.admin_generate_sourcing_order(p_mission_id uuid)
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
  v_allocated numeric;
  v_order_date timestamptz;
begin
  if not public.is_admin() then
    raise exception 'Accès refusé : réservé aux administrateurs';
  end if;

  select * into v_mission from public.b2b_sourcing_missions where id = p_mission_id for update;
  if not found then
    raise exception 'Mission introuvable';
  end if;
  if v_mission.status = 'cancelled' then
    raise exception 'Cette mission est annulée';
  end if;
  if v_mission.order_id is not null then
    raise exception 'Cette mission a déjà une commande';
  end if;

  create temporary table tmp_sourcing_order (
    item_id uuid primary key,
    product_id uuid,
    cost_price numeric,
    rn integer,
    alloc numeric
  ) on commit drop;

  insert into tmp_sourcing_order (item_id, product_id, cost_price, rn)
  select i.id, i.product_id, coalesce(i.cost_price, 0), row_number() over (order by i.created_at, i.id)
  from public.b2b_sourcing_items i
  where i.mission_id = p_mission_id and i.status <> 'cancelled';

  select count(*), coalesce(sum(cost_price), 0) into v_item_count, v_total_cost from tmp_sourcing_order;

  -- Mission sans pièce : simple clôture, rien à commander.
  if v_item_count = 0 then
    update public.b2b_sourcing_missions set status = 'completed' where id = p_mission_id;
    return jsonb_build_object('order_id', null, 'closed', true, 'items', 0);
  end if;

  if exists (select 1 from tmp_sourcing_order where product_id is null) then
    raise exception 'Certaines pièces n''ont pas de fiche produit : liez-les avant de générer la commande';
  end if;

  -- Répartition de l'avance au prorata du coût (parts égales si aucun coût),
  -- au centime ; la dernière pièce absorbe l'arrondi.
  update tmp_sourcing_order
  set alloc = round(
    case when v_total_cost > 0 then v_mission.advance_amount * cost_price / v_total_cost
         else v_mission.advance_amount / v_item_count end, 2)
  where rn < v_item_count;
  select coalesce(sum(alloc), 0) into v_allocated from tmp_sourcing_order where rn < v_item_count;
  update tmp_sourcing_order set alloc = v_mission.advance_amount - v_allocated where rn = v_item_count;

  v_order_date := coalesce(v_mission.completed_at, now());
  select contact_email into v_reseller_email from public.resellers where id = v_mission.reseller_id;

  insert into public.orders (
    order_number, email, status, total_amount, subtotal, shipping_cost, currency,
    payment_status, paid_at, reseller_id, placed_by_profile_id,
    order_channel, approval_status, approved_at, created_at
  ) values (
    v_mission.reference, v_reseller_email, 'confirmed', v_mission.advance_amount, v_mission.advance_amount, 0, 'EUR',
    'paid', coalesce(v_mission.paid_at, v_order_date), v_mission.reseller_id, v_mission.user_id,
    'b2b', 'approved', v_order_date, v_order_date
  )
  returning id into v_order_id;

  insert into public.order_items (order_id, product_id, quantity, unit_price, line_total, product_snapshot)
  select v_order_id, p.id, 1, t.alloc, t.alloc, to_jsonb(p.*)
  from tmp_sourcing_order t
  join public.products p on p.id = t.product_id;

  update public.products p
  set status = 'sold-b2b', reserved_by_reseller_id = v_mission.reseller_id, reserved_by_order_id = v_order_id,
      reserved_at = coalesce(p.reserved_at, v_order_date)
  from tmp_sourcing_order t
  where p.id = t.product_id;

  update public.b2b_sourcing_items
  set status = 'validated'
  where mission_id = p_mission_id and status <> 'cancelled';

  update public.b2b_sourcing_missions
  set status = 'completed', order_id = v_order_id, order_generated_by_admin = true
  where id = p_mission_id;

  return jsonb_build_object('order_id', v_order_id, 'order_number', v_mission.reference, 'items', v_item_count, 'total', v_mission.advance_amount);
end;
$$;

revoke all on function public.admin_generate_sourcing_order(uuid) from public, anon;
grant execute on function public.admin_generate_sourcing_order(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- generate_invoice_for_order (dernière version : 0196) : jamais de facture
-- séparée pour une commande générée par l'admin à la clôture d'une mission.
-- ----------------------------------------------------------------------------
create or replace function public.generate_invoice_for_order(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_profile public.profiles;
  v_existing_id uuid;
  v_advance record;
  v_year int;
  v_next_number int;
  v_invoice_number text;
  v_invoice_id uuid;
  v_invoice_type text;
begin
  select * into v_order from public.orders where id = p_order_id;
  if v_order is null then
    raise exception 'Commande introuvable';
  end if;

  if not (
    public.is_admin()
    or v_order.placed_by_profile_id = auth.uid()
    or v_order.email = (select email from public.profiles where id = auth.uid())
  ) then
    raise exception 'Accès refusé à cette commande';
  end if;

  select id into v_existing_id from public.invoices where order_id = p_order_id;
  if v_existing_id is not null then
    return jsonb_build_object('already_generated', true, 'invoice_id', v_existing_id);
  end if;

  select i.id, i.invoice_number into v_advance
  from public.invoices i
  join public.b2b_sourcing_missions m on m.id = i.sourcing_mission_id
  where m.order_id = p_order_id and i.kind = 'advance';
  if found then
    update public.invoices set order_id = p_order_id where id = v_advance.id;
    return jsonb_build_object('already_generated', true, 'invoice_id', v_advance.id, 'invoice_number', v_advance.invoice_number, 'advance', true);
  end if;

  if exists (select 1 from public.b2b_sourcing_missions where order_id = p_order_id and order_generated_by_admin) then
    raise exception 'Commande de sourcing sur mesure : la vente est déjà facturée par la mission (%), aucune facture séparée', v_order.order_number;
  end if;

  if v_order.status in ('cancelled', 'canceled') then
    raise exception 'Cette commande est annulée, aucune facture ne peut être générée';
  end if;

  if not (
    v_order.payment_status in ('paid', 'succeeded')
    or v_order.status in ('confirmed', 'shipped', 'delivered')
  ) then
    raise exception 'Cette commande n''est pas encore payée';
  end if;

  select * into v_profile from public.profiles where id = coalesce(v_order.placed_by_profile_id, (select id from public.profiles where email = v_order.email limit 1));
  if v_profile.id is null then
    raise exception 'Impossible de résoudre le profil client de cette commande';
  end if;
  if v_profile.legal_status is null then
    raise exception 'Statut juridique manquant : complétez le profil du client avant de générer sa facture';
  end if;

  v_invoice_type := case when v_profile.legal_status = 'individual' then 'b2c_retail' else 'b2b_facturx' end;

  v_year := extract(year from v_order.created_at)::int;

  insert into public.invoice_counters (year, last_number) values (v_year, 0)
    on conflict (year) do nothing;

  update public.invoice_counters
  set last_number = last_number + 1
  where year = v_year
  returning last_number into v_next_number;

  v_invoice_number := 'FAC-' || v_year || '-' || lpad(v_next_number::text, 5, '0');

  insert into public.invoices (order_id, profile_id, invoice_number, total_amount, legal_status, billing_details, issued_at, invoice_type, transmission_status)
  values (p_order_id, v_profile.id, v_invoice_number, v_order.total_amount, v_profile.legal_status, public.invoice_billing_details(v_profile), now(), v_invoice_type, 'not_applicable')
  returning id into v_invoice_id;

  return jsonb_build_object('already_generated', false, 'invoice_id', v_invoice_id, 'invoice_number', v_invoice_number, 'invoice_type', v_invoice_type);
end;
$$;

grant execute on function public.generate_invoice_for_order(uuid) to authenticated;

notify pgrst, 'reload schema';
