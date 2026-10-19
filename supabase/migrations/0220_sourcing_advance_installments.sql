-- ============================================================================
-- Factures d'avance en plusieurs fois (sourcing sur mesure, 0196).
--
-- advance_amount reste le BUDGET TOTAL de la mission. L'admin peut émettre
-- plusieurs factures d'avance partielles (« Avance n°1 », « n°2 »…) jusqu'à
-- ce budget. Chaque facture payée (qonto-sync) s'ajoute à paid_amount ;
-- paid_at (« avance encaissée », base de tous les chiffres existants) n'est
-- posé qu'une fois le budget total encaissé.
--   - plus d'unicité « une facture par mission » ni « une facture par
--     commande » pour les avances (toutes rattachées à la commande finale) ;
--     une commande garde au plus UNE facture de commande ;
--   - generate_advance_invoice_for_mission(p_mission_id, p_amount) : nouvelle
--     facture du montant demandé (par défaut, tout le reste à facturer) ;
--     réutilise une facture déjà générée mais pas encore émise sur Qonto ;
--   - generate_invoice_for_order : rattache TOUTES les avances de la mission.
-- ============================================================================

drop index if exists public.invoices_sourcing_mission_id_key;
alter table public.invoices drop constraint if exists invoices_order_id_key;
create unique index if not exists invoices_order_invoice_key
  on public.invoices (order_id) where order_id is not null and kind = 'order';
create index if not exists invoices_sourcing_mission_idx
  on public.invoices (sourcing_mission_id) where sourcing_mission_id is not null;

alter table public.b2b_sourcing_missions add column if not exists paid_amount numeric(10, 2) not null default 0;
update public.b2b_sourcing_missions set paid_amount = advance_amount where paid_at is not null and paid_amount = 0;

drop function if exists public.generate_advance_invoice_for_mission(uuid);

create or replace function public.generate_advance_invoice_for_mission(p_mission_id uuid, p_amount numeric default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mission record;
  v_profile public.profiles;
  v_pending record;
  v_invoiced numeric;
  v_remaining numeric;
  v_amount numeric;
  v_installment int;
  v_year int;
  v_next_number int;
  v_invoice_number text;
  v_invoice_id uuid;
  v_invoice_type text;
begin
  if not public.is_admin() then
    raise exception 'Accès refusé : réservé aux administrateurs';
  end if;

  select * into v_mission from public.b2b_sourcing_missions where id = p_mission_id;
  if not found then
    raise exception 'Mission de sourcing introuvable';
  end if;

  -- Facture déjà générée mais pas encore émise sur Qonto (échec d'émission) : on la reprend.
  select id, invoice_number, total_amount into v_pending
  from public.invoices
  where sourcing_mission_id = p_mission_id and kind = 'advance' and qonto_invoice_id is null
  order by issued_at desc
  limit 1;
  if found and (p_amount is null or round(p_amount, 2) = v_pending.total_amount) then
    return jsonb_build_object('already_generated', true, 'invoice_id', v_pending.id, 'invoice_number', v_pending.invoice_number);
  end if;

  if v_mission.status = 'cancelled' then
    raise exception 'Cette mission est annulée, aucune facture ne peut être générée';
  end if;
  if coalesce(v_mission.advance_amount, 0) <= 0 then
    raise exception 'Montant de l''avance manquant';
  end if;

  select coalesce(sum(total_amount), 0) into v_invoiced
  from public.invoices
  where sourcing_mission_id = p_mission_id and kind = 'advance'
    and transmission_status not in ('cancelled');
  v_remaining := round(v_mission.advance_amount - v_invoiced, 2);
  if v_remaining <= 0 then
    raise exception 'Le budget total de la mission est déjà entièrement facturé';
  end if;

  v_amount := round(coalesce(p_amount, v_remaining), 2);
  if v_amount <= 0 then
    raise exception 'Montant de la facture invalide';
  end if;
  if v_amount > v_remaining then
    raise exception 'Montant trop élevé : il reste % € à facturer sur cette mission', to_char(v_remaining, 'FM999999990.00');
  end if;

  select * into v_profile from public.profiles where id = v_mission.user_id;
  if v_profile.id is null then
    raise exception 'Aucun demandeur rattaché à cette mission';
  end if;
  if v_profile.legal_status is null then
    raise exception 'Statut juridique manquant : complétez le profil du membre avant de générer sa facture';
  end if;

  select count(*) + 1 into v_installment from public.invoices where sourcing_mission_id = p_mission_id and kind = 'advance';

  v_invoice_type := case when v_profile.legal_status = 'individual' then 'b2c_retail' else 'b2b_facturx' end;
  v_year := extract(year from now())::int;

  insert into public.invoice_counters (year, last_number) values (v_year, 0)
    on conflict (year) do nothing;

  update public.invoice_counters
  set last_number = last_number + 1
  where year = v_year
  returning last_number into v_next_number;

  v_invoice_number := 'FAC-' || v_year || '-' || lpad(v_next_number::text, 5, '0');

  insert into public.invoices (
    order_id, sourcing_mission_id, kind, profile_id, invoice_number, total_amount,
    legal_status, billing_details, issued_at, invoice_type, transmission_status
  )
  values (
    v_mission.order_id, p_mission_id, 'advance', v_profile.id, v_invoice_number, v_amount,
    v_profile.legal_status, public.invoice_billing_details(v_profile), now(), v_invoice_type, 'not_applicable'
  )
  returning id into v_invoice_id;

  return jsonb_build_object(
    'already_generated', false, 'invoice_id', v_invoice_id, 'invoice_number', v_invoice_number,
    'invoice_type', v_invoice_type, 'amount', v_amount, 'installment', v_installment,
    'remaining_after', round(v_remaining - v_amount, 2)
  );
end;
$$;

revoke all on function public.generate_advance_invoice_for_mission(uuid, numeric) from public, anon;
grant execute on function public.generate_advance_invoice_for_mission(uuid, numeric) to authenticated;

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

  select id into v_existing_id from public.invoices where order_id = p_order_id and kind = 'order';
  if v_existing_id is not null then
    return jsonb_build_object('already_generated', true, 'invoice_id', v_existing_id);
  end if;

  -- Mission de sourcing : TOUTES ses factures d'avance sont rattachées à la commande.
  select i.id, i.invoice_number into v_advance
  from public.invoices i
  join public.b2b_sourcing_missions m on m.id = i.sourcing_mission_id
  where m.order_id = p_order_id and i.kind = 'advance'
  order by i.issued_at
  limit 1;
  if found then
    update public.invoices i set order_id = p_order_id
    from public.b2b_sourcing_missions m
    where m.id = i.sourcing_mission_id and m.order_id = p_order_id and i.kind = 'advance';
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

notify pgrst, 'reload schema';
