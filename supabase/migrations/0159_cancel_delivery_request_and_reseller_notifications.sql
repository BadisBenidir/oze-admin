-- ============================================================================
-- Annulation d'une demande de livraison par un admin + notifications
-- revendeur.
--
-- Cas réel : une demande de livraison a été payée pour des articles pointés
-- "prêts à expédier" par erreur alors qu'ils étaient encore en acheminement
-- vers l'atelier. L'admin doit pouvoir annuler la demande (sans Sendcloud),
-- remettre les articles "en acheminement" (fulfillment_status = 'ordered')
-- et prévenir le revendeur, qui est ensuite prévenu une seconde fois dès que
-- ces articles sont réellement prêts (trigger plus bas).
--
-- La demande n'est PAS supprimée (contrairement au détachement article par
-- article de 0081) : elle garde la trace du paiement des frais de port et de
-- leur éventuel remboursement, avec le statut 'cancelled' — exclu de tous les
-- onglets admin, qui filtrent sur une liste de statuts explicite.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. shipments : statut 'cancelled' + traçabilité
-- ----------------------------------------------------------------------------
alter table public.shipments drop constraint if exists shipments_status_check;
alter table public.shipments add constraint shipments_status_check
  check (status in ('requested', 'preparing', 'in_transit', 'delivered', 'cancelled'));

alter table public.shipments add column if not exists cancelled_at timestamptz;
alter table public.shipments add column if not exists cancellation_reason text;
alter table public.shipments add column if not exists shipping_refund_status text
  check (shipping_refund_status is null or shipping_refund_status in ('not_applicable', 'succeeded', 'failed'));
alter table public.shipments add column if not exists shipping_refund_method text
  check (shipping_refund_method is null or shipping_refund_method in ('wallet', 'stripe', 'none'));
alter table public.shipments add column if not exists shipping_refund_error text;

-- Profil à prévenir quand l'article redevient réellement prêt à expédier
-- (posé par l'annulation, consommé puis effacé par le trigger plus bas).
alter table public.order_items add column if not exists redelivery_notice_profile_id uuid references public.profiles (id) on delete set null;

-- ----------------------------------------------------------------------------
-- 2. reseller_notifications : messages affichés dans l'espace pro jusqu'à
-- ce que le revendeur clique "J'ai compris".
-- ----------------------------------------------------------------------------
create table if not exists public.reseller_notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  reseller_id uuid references public.resellers (id) on delete cascade,
  type text not null,
  title text not null,
  message text not null,
  -- ex. { "items": [{ "reference": "OZE-B2B-2026-7434", "name": "..." }] }
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists reseller_notifications_unread_idx
  on public.reseller_notifications (profile_id) where read_at is null;

alter table public.reseller_notifications enable row level security;

drop policy if exists reseller_notifications_select_own on public.reseller_notifications;
create policy reseller_notifications_select_own on public.reseller_notifications
  for select using (profile_id = auth.uid());

drop policy if exists reseller_notifications_admin_all on public.reseller_notifications;
create policy reseller_notifications_admin_all on public.reseller_notifications
  for all using (public.is_admin()) with check (public.is_admin());

-- Le revendeur ne peut que marquer SES notifications comme lues — jamais
-- modifier leur contenu (pas de policy UPDATE côté revendeur).
create or replace function public.mark_reseller_notification_read(p_notification_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.reseller_notifications
  set read_at = now()
  where id = p_notification_id and profile_id = auth.uid() and read_at is null;
$$;

grant execute on function public.mark_reseller_notification_read(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. admin_cancel_delivery_request_core : annulation atomique. Service-role
-- uniquement (Edge Function cancel-delivery-request, qui vérifie le rôle
-- admin puis rembourse les frais de port selon le choix de l'admin).
-- ----------------------------------------------------------------------------
create or replace function public.admin_cancel_delivery_request_core(
  p_shipment_id uuid,
  p_reason text,
  p_refund_method text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shipment record;
  v_items jsonb;
  v_item_ids uuid[];
  v_default_reason constant text := 'Erreur de pointage logistique : articles encore en transit';
  v_message text;
begin
  if p_refund_method not in ('wallet', 'stripe', 'none') then
    raise exception 'refund_method invalide : %', p_refund_method;
  end if;

  select * into v_shipment from public.shipments where id = p_shipment_id for update;
  if not found then
    raise exception 'Demande de livraison introuvable';
  end if;
  if v_shipment.status = 'cancelled' then
    raise exception 'Cette demande est déjà annulée';
  end if;
  if v_shipment.status <> 'requested' then
    raise exception 'Cette demande a déjà une étiquette Sendcloud — annulez d''abord les colis concernés';
  end if;
  if exists (
    select 1 from public.shipment_parcels
    where shipment_id = p_shipment_id and status in ('label_created', 'shipped', 'delivered')
  ) or exists (
    select 1 from public.order_items
    where shipment_id = p_shipment_id and fulfillment_status in ('label_created', 'shipped', 'delivered')
  ) then
    raise exception 'Cette demande a déjà une étiquette Sendcloud — annulez d''abord les colis concernés';
  end if;

  if p_refund_method = 'stripe' and (v_shipment.stripe_session_id is null or coalesce(v_shipment.shipping_cost, 0) <= 0) then
    raise exception 'Aucun paiement Stripe de frais de port sur cette demande — choisissez le crédit ou aucun remboursement';
  end if;

  select
    coalesce(jsonb_agg(jsonb_build_object(
      'reference', coalesce(p.b2b_reference, p.reference, p.product_code, oi.product_snapshot->>'reference', oi.product_snapshot->>'product_code', '—'),
      'name', coalesce(p.name, oi.product_snapshot->>'name', 'Article')
    ) order by oi.delivery_requested_at, oi.id), '[]'::jsonb),
    array_agg(oi.id)
  into v_items, v_item_ids
  from public.order_items oi
  left join public.products p on p.id = oi.product_id
  where oi.shipment_id = p_shipment_id and oi.fulfillment_status = 'delivery_requested';

  if v_item_ids is null then
    raise exception 'Aucun article à annuler sur cette demande';
  end if;

  -- Retour "en acheminement vers l'atelier" : l'article devra de nouveau
  -- être réceptionné puis pointé prêt avant toute nouvelle demande.
  update public.order_items
  set fulfillment_status = 'ordered',
      received_at = null,
      ready_to_ship_at = null,
      delivery_requested_at = null,
      shipment_id = null,
      redelivery_notice_profile_id = v_shipment.requested_by_profile_id
  where id = any(v_item_ids);

  -- Colis jamais créés chez Sendcloud (échecs/brouillons) : sans valeur.
  delete from public.shipment_parcels where shipment_id = p_shipment_id;

  update public.shipments
  set status = 'cancelled',
      cancelled_at = now(),
      cancellation_reason = p_reason,
      shipping_refund_status = case when p_refund_method = 'none' or coalesce(shipping_cost, 0) <= 0 then 'not_applicable' else null end,
      shipping_refund_method = p_refund_method,
      updated_at = now()
  where id = p_shipment_id;

  if v_shipment.requested_by_profile_id is not null then
    v_message := 'Suite à une erreur de pointage, les articles suivants sont encore en cours d''acheminement vers notre atelier et n''ont pas encore été expédiés. Vous serez notifié dès leur réception réelle pour relancer la livraison.';
    if nullif(trim(p_reason), '') is not null and trim(p_reason) <> v_default_reason then
      v_message := v_message || E'\nMotif : ' || trim(p_reason);
    end if;
    if p_refund_method in ('wallet', 'stripe') and coalesce(v_shipment.shipping_cost, 0) > 0 then
      v_message := v_message || E'\nLes frais de port (' || to_char(v_shipment.shipping_cost, 'FM999999990.00') || ' €) vous sont remboursés '
        || case when p_refund_method = 'stripe' then 'sur votre carte bancaire.' else 'sur votre solde OZË.' end;
    end if;

    insert into public.reseller_notifications (profile_id, reseller_id, type, title, message, payload)
    values (
      v_shipment.requested_by_profile_id,
      v_shipment.reseller_id,
      'delivery_request_cancelled',
      'Information sur votre demande de livraison',
      v_message,
      jsonb_build_object('shipment_id', p_shipment_id, 'items', v_items)
    );
  end if;

  return jsonb_build_object(
    'shipment_id', p_shipment_id,
    'item_count', array_length(v_item_ids, 1),
    'shipping_cost', coalesce(v_shipment.shipping_cost, 0),
    'stripe_session_id', v_shipment.stripe_session_id,
    'reseller_id', v_shipment.reseller_id,
    'profile_id', v_shipment.requested_by_profile_id
  );
end;
$$;

revoke all on function public.admin_cancel_delivery_request_core(uuid, text, text) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. Seconde notification : dès qu'un article annulé redevient réellement
-- "prêt à expédier" (réception + pointage admin), le revendeur est prévenu
-- qu'il peut relancer sa demande. Trigger niveau instruction (tables de
-- transition) pour regrouper en UNE notification par revendeur les articles
-- pointés ensemble (admin_mark_items_ready_to_ship traite un lot).
-- ----------------------------------------------------------------------------
create or replace function public.notify_redelivery_ready()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group record;
begin
  -- Le nettoyage de redelivery_notice_profile_id ci-dessous refait un UPDATE
  -- sur order_items : ne jamais se redéclencher sur soi-même.
  if pg_trigger_depth() > 1 then
    return null;
  end if;

  for v_group in
    select n.redelivery_notice_profile_id as profile_id,
           max(o.reseller_id::text)::uuid as reseller_id,
           array_agg(n.id) as item_ids,
           jsonb_agg(jsonb_build_object(
             'reference', coalesce(p.b2b_reference, p.reference, p.product_code, n.product_snapshot->>'reference', n.product_snapshot->>'product_code', '—'),
             'name', coalesce(p.name, n.product_snapshot->>'name', 'Article')
           ) order by n.id) as items
    from new_rows n
    join public.orders o on o.id = n.order_id
    left join public.products p on p.id = n.product_id
    where n.fulfillment_status = 'ready_to_ship'
      and n.redelivery_notice_profile_id is not null
      and n.status = 'active'
    group by n.redelivery_notice_profile_id
  loop
    insert into public.reseller_notifications (profile_id, reseller_id, type, title, message, payload)
    values (
      v_group.profile_id,
      v_group.reseller_id,
      'redelivery_ready',
      'Vos articles sont arrivés à l''atelier',
      'Les articles suivants ont bien été réceptionnés et sont prêts à être expédiés. Vous pouvez relancer votre demande de livraison depuis « Mes commandes ».',
      jsonb_build_object('items', v_group.items)
    );

    update public.order_items set redelivery_notice_profile_id = null where id = any(v_group.item_ids);
  end loop;

  return null;
end;
$$;

drop trigger if exists order_items_notify_redelivery_ready on public.order_items;
create trigger order_items_notify_redelivery_ready
  after update on public.order_items
  referencing new table as new_rows
  for each statement
  execute function public.notify_redelivery_ready();

notify pgrst, 'reload schema';
