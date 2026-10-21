-- ============================================================================
-- Facture commune à plusieurs commandes B2B (parties dans le même colis).
--
-- invoices.merged_into_invoice_id : la facture d'une commande « rattachée »
-- pointe vers la facture principale (la plus ancienne du groupe). Le PDF de la
-- facture principale reprend les articles de TOUTES les commandes du groupe,
-- avec le total cumulé ; télécharger la facture depuis n'importe quelle
-- commande du groupe donne ce même document (useInvoices.downloadInvoice).
-- Les montants de chaque ligne invoices restent ceux de leur commande.
--   - admin_link_order_invoices(p_order_ids) : lie des commandes du même
--     acheteur (factures générées si besoin) ; jamais une facture déjà émise
--     sur Qonto (document finalisé, non modifiable) ;
--   - admin_unlink_order_invoice(p_order_id) : retire une commande du groupe
--     (ou dissout le groupe si c'est la facture principale).
-- ============================================================================

alter table public.invoices add column if not exists merged_into_invoice_id uuid
  references public.invoices (id) on delete set null;

create index if not exists invoices_merged_into_idx on public.invoices (merged_into_invoice_id) where merged_into_invoice_id is not null;

create or replace function public.admin_link_order_invoices(p_order_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_ids uuid[];
  v_primary record;
  v_profiles integer;
begin
  if not public.is_admin() then
    raise exception 'Accès refusé : réservé aux administrateurs';
  end if;
  if p_order_ids is null or array_length(p_order_ids, 1) < 2 then
    raise exception 'Sélectionnez au moins deux commandes';
  end if;

  -- Factures générées si besoin (mêmes règles que le téléchargement).
  foreach v_order_id in array p_order_ids loop
    perform public.generate_invoice_for_order(v_order_id);
  end loop;

  -- Factures concernées, plus celles déjà rattachées à l'une d'elles (groupe existant).
  select array_agg(distinct i.id) into v_ids
  from public.invoices i
  where i.kind = 'order'
    and (i.order_id = any(p_order_ids)
         or i.merged_into_invoice_id in (select id from public.invoices where order_id = any(p_order_ids) and kind = 'order')
         or i.id in (select merged_into_invoice_id from public.invoices where order_id = any(p_order_ids) and kind = 'order'));

  if exists (select 1 from public.invoices where id = any(v_ids) and qonto_invoice_id is not null) then
    raise exception 'Une de ces factures est déjà émise sur Qonto (document finalisé) : impossible de la regrouper';
  end if;

  select count(distinct profile_id) into v_profiles from public.invoices where id = any(v_ids);
  if v_profiles > 1 then
    raise exception 'Ces commandes n''ont pas été passées par le même acheteur';
  end if;

  select id, invoice_number into v_primary
  from public.invoices
  where id = any(v_ids)
  order by issued_at, invoice_number
  limit 1;

  update public.invoices
  set merged_into_invoice_id = case when id = v_primary.id then null else v_primary.id end
  where id = any(v_ids);

  return jsonb_build_object('primary_invoice_id', v_primary.id, 'primary_invoice_number', v_primary.invoice_number, 'invoice_count', array_length(v_ids, 1));
end;
$$;

create or replace function public.admin_unlink_order_invoice(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice record;
begin
  if not public.is_admin() then
    raise exception 'Accès refusé : réservé aux administrateurs';
  end if;
  select id, merged_into_invoice_id into v_invoice from public.invoices where order_id = p_order_id and kind = 'order';
  if not found then
    raise exception 'Aucune facture pour cette commande';
  end if;

  if v_invoice.merged_into_invoice_id is not null then
    update public.invoices set merged_into_invoice_id = null where id = v_invoice.id;
  else
    -- Facture principale : le groupe est dissous.
    update public.invoices set merged_into_invoice_id = null where merged_into_invoice_id = v_invoice.id;
  end if;
  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.admin_link_order_invoices(uuid[]) from public, anon;
grant execute on function public.admin_link_order_invoices(uuid[]) to authenticated;
revoke all on function public.admin_unlink_order_invoice(uuid) from public, anon;
grant execute on function public.admin_unlink_order_invoice(uuid) to authenticated;

notify pgrst, 'reload schema';
