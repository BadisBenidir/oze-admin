-- ============================================================================
-- Annulation d'articles depuis une demande de livraison (article jamais reçu
-- à l'atelier, ex. sac perdu chez le fournisseur) — ADMIN UNIQUEMENT, via
-- l'Edge Function cancel-shipment-items.
--
-- L'article lui-même est annulé par cancel_b2b_order_item (0146 : recalcul de
-- la commande, produit remis au statut choisi) puis remboursé par l'Edge
-- Function. Mais cancel_b2b_order_item ne touche pas à la demande de
-- livraison : l'article annulé y restait "en attente". Cette fonction l'en
-- détache et, s'il n'y reste plus aucun article actif, passe la demande en
-- 'cancelled' (statut ajouté en 0159) avec la traçabilité du remboursement
-- des frais de port.
-- ============================================================================

create or replace function public.admin_detach_cancelled_items_from_shipment_core(
  p_shipment_id uuid,
  p_item_ids uuid[],
  p_reason text,
  p_shipping_refund_method text,
  p_shipping_refund_amount numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shipment record;
  v_detached int;
  v_remaining int;
  v_new_status text;
begin
  if p_shipping_refund_method not in ('wallet', 'stripe', 'none') then
    raise exception 'refund_method invalide : %', p_shipping_refund_method;
  end if;

  select * into v_shipment from public.shipments where id = p_shipment_id for update;
  if not found then
    raise exception 'Demande de livraison introuvable';
  end if;

  if p_shipping_refund_method <> 'none' then
    if coalesce(p_shipping_refund_amount, 0) <= 0 or p_shipping_refund_amount > coalesce(v_shipment.shipping_cost, 0) then
      raise exception 'Montant de remboursement des frais de port invalide (max %)', coalesce(v_shipment.shipping_cost, 0);
    end if;
    if p_shipping_refund_method = 'stripe' and v_shipment.stripe_session_id is null then
      raise exception 'Aucun paiement Stripe de frais de port sur cette demande';
    end if;
  end if;

  update public.order_items
  set shipment_id = null, delivery_requested_at = null
  where id = any(p_item_ids) and shipment_id = p_shipment_id and status = 'cancelled';
  get diagnostics v_detached = row_count;

  select count(*) into v_remaining
  from public.order_items
  where shipment_id = p_shipment_id and status = 'active';

  if v_remaining = 0 then
    delete from public.shipment_parcels where shipment_id = p_shipment_id and status in ('pending', 'failed');
    update public.shipments
    set status = 'cancelled',
        cancelled_at = now(),
        cancellation_reason = p_reason,
        updated_at = now()
    where id = p_shipment_id;
    v_new_status := 'cancelled';
  else
    v_new_status := v_shipment.status;
  end if;

  if p_shipping_refund_method <> 'none' then
    update public.shipments
    set shipping_refund_method = p_shipping_refund_method
    where id = p_shipment_id;
  end if;

  return jsonb_build_object(
    'shipment_id', p_shipment_id,
    'detached', v_detached,
    'remaining_items', v_remaining,
    'shipment_status', v_new_status,
    'stripe_session_id', v_shipment.stripe_session_id,
    'reseller_id', v_shipment.reseller_id,
    'profile_id', v_shipment.requested_by_profile_id
  );
end;
$$;

revoke all on function public.admin_detach_cancelled_items_from_shipment_core(uuid, uuid[], text, text, numeric) from public, anon, authenticated;

notify pgrst, 'reload schema';
