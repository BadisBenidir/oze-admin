-- ============================================================================
-- Une commande annulée garde payment_status = 'paid' (le paiement a bien eu
-- lieu, seul un remboursement suit) : sans exclusion explicite de
-- status = 'cancelled', generate_invoice_for_order pouvait émettre une
-- facture pour une commande entièrement annulée. Corrige ce même trou déjà
-- corrigé côté TypeScript (isOrderPaid, useAccountingRawData.ts /
-- useSalesJournalExport.ts) qui gonflait à tort le CA/marge affichés dans
-- Comptabilité & Finances pour les commandes annulées.
-- ============================================================================

create or replace function public.generate_invoice_for_order(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_profile record;
  v_existing_id uuid;
  v_billing jsonb;
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
  if v_profile is null then
    raise exception 'Impossible de résoudre le profil client de cette commande';
  end if;
  if v_profile.legal_status is null then
    raise exception 'Statut juridique manquant : complétez le profil du client avant de générer sa facture';
  end if;

  v_invoice_type := case when v_profile.legal_status = 'individual' then 'b2c_retail' else 'b2b_facturx' end;

  if v_profile.legal_status = 'individual' then
    v_billing := jsonb_build_object(
      'name', trim(coalesce(v_profile.first_name, '') || ' ' || coalesce(v_profile.last_name, '')),
      'address', v_profile.address,
      'city', v_profile.city,
      'postal_code', v_profile.postal_code,
      'country', public.country_name_to_iso(v_profile.country)
    );
  else
    v_billing := jsonb_build_object(
      'entity_name', v_profile.legal_entity_name,
      'legal_form', v_profile.legal_form,
      'siret', v_profile.siret,
      'vat_number', v_profile.vat_number,
      'address', v_profile.legal_address,
      'city', v_profile.legal_city,
      'postal_code', v_profile.legal_postal_code,
      'country', public.country_name_to_iso(v_profile.legal_country)
    );
  end if;

  v_year := extract(year from v_order.created_at)::int;

  insert into public.invoice_counters (year, last_number) values (v_year, 0)
    on conflict (year) do nothing;

  update public.invoice_counters
  set last_number = last_number + 1
  where year = v_year
  returning last_number into v_next_number;

  v_invoice_number := 'FAC-' || v_year || '-' || lpad(v_next_number::text, 5, '0');

  insert into public.invoices (order_id, profile_id, invoice_number, total_amount, legal_status, billing_details, issued_at, invoice_type, transmission_status)
  values (p_order_id, v_profile.id, v_invoice_number, v_order.total_amount, v_profile.legal_status, v_billing, now(), v_invoice_type, 'not_applicable')
  returning id into v_invoice_id;

  return jsonb_build_object('already_generated', false, 'invoice_id', v_invoice_id, 'invoice_number', v_invoice_number, 'invoice_type', v_invoice_type);
end;
$$;

grant execute on function public.generate_invoice_for_order(uuid) to authenticated;

notify pgrst, 'reload schema';
