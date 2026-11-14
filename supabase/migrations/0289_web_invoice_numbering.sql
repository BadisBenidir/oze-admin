-- Numérotation des factures web (storefront, fonction order-invoice).
--
-- L'ancienne série FA-AAAA-MM-NNNN (assign_invoice_number, migration
-- storefront 20260618) est cassée depuis que invoice_counters est passé au
-- format de l'admin (year, last_number) : une facture web générée depuis
-- affichait le numéro de COMMANDE à la place d'un numéro de facture.
--
-- assign_web_invoice(p_order_id) : facture de la commande dans la série
-- unique de l'admin (FAC-AAAA-NNNNN, table invoices), idempotent.
--   - commande déjà facturée en FA-… (orders.invoice_number) : numéro inchangé ;
--   - facture admin existante (invoices kind order) : son numéro ;
--   - sinon, et seulement pour une vraie vente (payée / confirmée), création
--     d'une facture b2c_retail sans profil (achat invité), coordonnées de
--     livraison comme facturation ; TVA figée par invoices_stamp_vat_rate
--     d'après la date de la commande.
-- Réservée au serveur (service_role : order-invoice).

create or replace function public.assign_web_invoice(p_order_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_num text;
  v_year int := extract(year from now())::int;
  v_next int;
  v_sa jsonb;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    return null;
  end if;

  select invoice_number into v_num from public.invoices
  where order_id = p_order_id and kind = 'order'
  order by issued_at desc limit 1;
  if v_num is not null then
    return v_num;
  end if;
  if v_order.invoice_number is not null and btrim(v_order.invoice_number) <> '' then
    return v_order.invoice_number;
  end if;

  if v_order.status in ('cancelled', 'canceled') or not (
    v_order.payment_status in ('paid', 'succeeded') or v_order.status in ('confirmed', 'shipped', 'delivered')
  ) then
    return null;
  end if;

  v_sa := coalesce(v_order.shipping_address, '{}'::jsonb);
  insert into public.invoice_counters (year, last_number) values (v_year, 0) on conflict (year) do nothing;
  update public.invoice_counters set last_number = last_number + 1 where year = v_year returning last_number into v_next;
  v_num := 'FAC-' || v_year || '-' || lpad(v_next::text, 5, '0');

  insert into public.invoices (order_id, profile_id, kind, invoice_number, total_amount, legal_status, billing_details,
                               issued_at, invoice_type, transmission_status)
  values (
    p_order_id, null, 'order', v_num, v_order.total_amount, 'individual',
    jsonb_strip_nulls(jsonb_build_object(
      'name', coalesce(nullif(v_sa->>'name', ''), nullif(trim(coalesce(v_sa->>'first_name', '') || ' ' || coalesce(v_sa->>'last_name', '')), ''), v_order.email),
      'address', v_sa->>'address',
      'postal_code', v_sa->>'postcode',
      'city', v_sa->>'city',
      'country', coalesce(public.country_name_to_iso(v_sa->>'country'), 'FR')
    )),
    now(), 'b2c_retail', 'not_applicable'
  );
  return v_num;
end;
$$;

revoke all on function public.assign_web_invoice(uuid) from public, anon, authenticated;
grant execute on function public.assign_web_invoice(uuid) to service_role;
