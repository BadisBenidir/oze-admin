-- ============================================================================
-- Facture d'avance des missions de sourcing sur mesure.
--
-- Le membre verse TOUJOURS la totalité de l'avance avant le sourcing : la
-- facture d'avance est donc LA facture de la mission (montant = advance_amount),
-- émise dès la création de la mission puis envoyée depuis Qonto pour demander
-- le paiement (virement). Elle ne doit jamais être doublée par une seconde
-- facture à la validation : quand le membre valide sa sélection (commande
-- générée par reseller_validate_sourcing_mission), generate_invoice_for_order
-- rattache cette facture d'avance à la commande au lieu d'en créer une autre.
--
-- invoices.order_id devient donc nullable (une facture d'avance existe avant
-- toute commande) ; kind distingue 'order' (historique) de 'advance'.
-- ============================================================================

alter table public.invoices alter column order_id drop not null;

alter table public.invoices add column if not exists kind text not null default 'order';
alter table public.invoices drop constraint if exists invoices_kind_check;
alter table public.invoices add constraint invoices_kind_check check (kind in ('order', 'advance'));

-- on delete set null : une facture émise reste une pièce comptable même si la
-- mission est supprimée (numéro, montant et billing_details sont figés).
alter table public.invoices add column if not exists sourcing_mission_id uuid
  references public.b2b_sourcing_missions (id) on delete set null;

create unique index if not exists invoices_sourcing_mission_id_key
  on public.invoices (sourcing_mission_id) where sourcing_mission_id is not null;

-- Le membre (demandeur de la mission) voit sa facture d'avance — même règle
-- que pour les factures de commande (profile_id = auth.uid(), 0115).

-- ----------------------------------------------------------------------------
-- Snapshot de facturation d'un profil (même règle que generate_invoice_for_order).
-- ----------------------------------------------------------------------------
create or replace function public.invoice_billing_details(p_profile public.profiles)
returns jsonb
language sql
stable
set search_path = public
as $$
  select case
    when p_profile.legal_status = 'individual' then jsonb_build_object(
      'name', trim(coalesce(p_profile.first_name, '') || ' ' || coalesce(p_profile.last_name, '')),
      'address', p_profile.address,
      'city', p_profile.city,
      'postal_code', p_profile.postal_code,
      'country', public.country_name_to_iso(p_profile.country)
    )
    else jsonb_build_object(
      'entity_name', p_profile.legal_entity_name,
      'legal_form', p_profile.legal_form,
      'siret', p_profile.siret,
      'vat_number', p_profile.vat_number,
      'address', p_profile.legal_address,
      'city', p_profile.legal_city,
      'postal_code', p_profile.legal_postal_code,
      'country', public.country_name_to_iso(p_profile.legal_country)
    )
  end;
$$;

-- ----------------------------------------------------------------------------
-- Génère (idempotent) la facture d'avance d'une mission — admin uniquement.
-- Numérotation FAC-YYYY-NNNNN partagée avec les factures de commande.
-- ----------------------------------------------------------------------------
create or replace function public.generate_advance_invoice_for_mission(p_mission_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mission record;
  v_profile public.profiles;
  v_existing record;
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

  select id, invoice_number into v_existing from public.invoices where sourcing_mission_id = p_mission_id;
  if found then
    return jsonb_build_object('already_generated', true, 'invoice_id', v_existing.id, 'invoice_number', v_existing.invoice_number);
  end if;

  if v_mission.status = 'cancelled' then
    raise exception 'Cette mission est annulée, aucune facture ne peut être générée';
  end if;
  if coalesce(v_mission.advance_amount, 0) <= 0 then
    raise exception 'Montant de l''avance manquant';
  end if;

  select * into v_profile from public.profiles where id = v_mission.user_id;
  if v_profile.id is null then
    raise exception 'Aucun demandeur rattaché à cette mission';
  end if;
  if v_profile.legal_status is null then
    raise exception 'Statut juridique manquant : complétez le profil du membre avant de générer sa facture';
  end if;

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
    v_mission.order_id, p_mission_id, 'advance', v_profile.id, v_invoice_number, v_mission.advance_amount,
    v_profile.legal_status, public.invoice_billing_details(v_profile), now(), v_invoice_type, 'not_applicable'
  )
  returning id into v_invoice_id;

  return jsonb_build_object('already_generated', false, 'invoice_id', v_invoice_id, 'invoice_number', v_invoice_number, 'invoice_type', v_invoice_type);
end;
$$;

revoke all on function public.generate_advance_invoice_for_mission(uuid) from public, anon;
grant execute on function public.generate_advance_invoice_for_mission(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- generate_invoice_for_order (dernière version : 0121) : une commande issue
-- d'une mission qui a déjà sa facture d'avance réutilise CETTE facture
-- (rattachée à la commande) — jamais de seconde facture pour la même vente.
-- Après « Annuler la validation » puis nouvelle validation, la facture
-- d'avance est rattachée à la nouvelle commande.
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
