-- ============================================================================
-- Corrige admin_cancel_entrupy_certificate (0140) : son garde-fou interne
-- `if not public.is_admin() then raise exception 'Accès refusé'` échouait
-- TOUJOURS, quel que soit l'appelant réel — cancel-entrupy-certificate
-- (Edge Function) l'appelle via le client SERVICE ROLE, qui ne porte aucun
-- JWT utilisateur, donc auth.uid() y est systématiquement NULL et is_admin()
-- renvoie systématiquement faux.
--
-- Même schéma que cancel_b2b_order_item (0032, voir son commentaire dans
-- cancel-b2b-order-item/index.ts) : ces fonctions SECURITY DEFINER appelées
-- depuis une Edge Function ne vérifient elles-mêmes AUCUNE autorisation —
-- l'Edge Function a déjà vérifié `profiles.role = 'admin'` avant l'appel
-- (voir cancel-entrupy-certificate/index.ts), ce contrôle interne était donc
-- à la fois redondant ET cassé dans ce contexte d'appel précis.
-- ============================================================================

create or replace function public.admin_cancel_entrupy_certificate(p_order_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item record;
  v_order record;
  v_amount numeric;
begin
  select * into v_item from public.order_items where id = p_order_item_id for update;
  if v_item is null then
    raise exception 'Article introuvable';
  end if;
  if v_item.status <> 'active' then
    raise exception 'Cet article est annulé';
  end if;
  if not v_item.entrupy_requested then
    raise exception 'Aucun certificat Entrupy sur cet article';
  end if;

  v_amount := v_item.entrupy_cost;

  update public.order_items
  set entrupy_requested = false, entrupy_cost = 0
  where id = p_order_item_id;

  select * into v_order from public.orders where id = v_item.order_id for update;

  update public.orders
  set entrupy_cost = greatest(entrupy_cost - v_amount, 0),
      total_amount = greatest(total_amount - v_amount, 0)
  where id = v_item.order_id;

  return jsonb_build_object(
    'order_id', v_item.order_id,
    'refund_amount', v_amount,
    'payment_status', v_order.payment_status,
    'placed_by_profile_id', v_order.placed_by_profile_id,
    'reseller_id', v_order.reseller_id
  );
end;
$$;

-- Appelée uniquement par cancel-entrupy-certificate (service_role) — jamais
-- directement par un revendeur, qui n'a de toute façon aucun intérêt à
-- l'invoquer lui-même (aucune vérification de propriété de la commande ici,
-- volontairement, puisque l'autorisation admin est déjà actée en amont).
revoke all on function public.admin_cancel_entrupy_certificate(uuid) from public, authenticated;
grant execute on function public.admin_cancel_entrupy_certificate(uuid) to service_role;

notify pgrst, 'reload schema';
