-- ============================================================================
-- Suivi de statut par article B2B (remplace delivery_batches, voir 0060) :
-- chaque order_item traverse ordered -> received -> ready_to_ship ->
-- delivery_requested -> shipped, indépendamment des autres articles de la
-- même commande. `shipments` regroupe les articles qu'un revendeur a
-- demandé à faire livrer en une fois ; `shipment_parcels` gère le multi-colis
-- (1 lot de livraison peut être scindé en plusieurs colis Sendcloud).
-- ============================================================================

create table public.shipments (
  id uuid primary key default gen_random_uuid(),
  reseller_id uuid not null references public.resellers(id),
  requested_by_profile_id uuid references public.profiles(id),
  requested_at timestamptz not null default now(),
  delivery_type text not null check (delivery_type in ('domicile', 'point_relais')),
  parcel_point jsonb,
  delivery_instructions text,
  status text not null default 'requested' check (status in ('requested', 'partially_shipped', 'shipped')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_shipments_reseller on public.shipments(reseller_id);
create index idx_shipments_status on public.shipments(status);

create table public.shipment_parcels (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments(id),
  parcel_index int not null check (parcel_index >= 1),
  status text not null default 'pending' check (status in ('pending', 'shipped', 'failed')),
  sendcloud_parcel_id text,
  tracking_number text,
  tracking_url text,
  label_url text,
  weight_kg numeric(6,3),
  error_message text,
  shipped_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shipment_id, parcel_index)
);

create index idx_shipment_parcels_shipment on public.shipment_parcels(shipment_id);

alter table public.order_items add column if not exists fulfillment_status text
  not null default 'ordered'
  check (fulfillment_status in ('ordered', 'received', 'ready_to_ship', 'delivery_requested', 'shipped'));
alter table public.order_items add column if not exists shipment_id uuid references public.shipments(id);
alter table public.order_items add column if not exists parcel_id uuid references public.shipment_parcels(id);
alter table public.order_items add column if not exists received_at timestamptz;
alter table public.order_items add column if not exists ready_to_ship_at timestamptz;
alter table public.order_items add column if not exists delivery_requested_at timestamptz;
alter table public.order_items add column if not exists shipped_at timestamptz;

create index if not exists idx_order_items_fulfillment_status on public.order_items(fulfillment_status);
create index if not exists idx_order_items_shipment_id on public.order_items(shipment_id);
create index if not exists idx_order_items_parcel_id on public.order_items(parcel_id);

alter table public.shipments enable row level security;

create policy "Admins can view all shipments"
  on public.shipments for select
  using (public.is_admin());

create policy "Resellers can view their own shipments"
  on public.shipments for select
  using (reseller_id = public.current_reseller_id());

alter table public.shipment_parcels enable row level security;

create policy "Admins can view all shipment parcels"
  on public.shipment_parcels for select
  using (public.is_admin());

create policy "Resellers can view their own shipment parcels"
  on public.shipment_parcels for select
  using (
    exists (
      select 1 from public.shipments s
      where s.id = shipment_id and s.reseller_id = public.current_reseller_id()
    )
  );

-- Aucune policy insert/update sur les deux tables : toutes les écritures
-- passent par les RPCs SECURITY DEFINER (0063) ou l'edge function
-- generate-b2b-shipment-labels (rôle service_role), même convention que
-- delivery_batches.

notify pgrst, 'reload schema';
