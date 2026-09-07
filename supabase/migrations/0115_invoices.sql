-- ============================================================================
-- Facturation automatique — dès qu'un profil a un statut juridique complet
-- (legal_status, voir 0109), ses commandes payées deviennent facturables.
-- Le PDF n'est jamais stocké : seules les métadonnées figées au moment de
-- l'émission (billing_details) sont conservées ici, le PDF est régénéré à
-- la demande depuis ces données (voir generateInvoicePdf.ts, jsPDF déjà une
-- dépendance de ce repo — voir ProductLabel.tsx).
--
-- Convention reprise sans dérogation : FK vers "l'utilisateur" -> profiles(id),
-- jamais auth.users(id) (profiles.id = auth.uid() partout dans ce schéma).
-- ============================================================================

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders (id) on delete cascade,
  profile_id uuid not null references public.profiles (id),
  invoice_number text not null unique,
  issued_at timestamptz not null default now(),
  total_amount numeric(10, 2) not null,
  legal_status text not null check (legal_status in ('individual', 'sole_proprietorship', 'company')),
  -- Copie figée au moment de l'émission (nom/dénomination, SIRET, TVA,
  -- adresse) : ne doit JAMAIS changer rétroactivement si le profil est
  -- modifié après coup — une facture émise est un document figé.
  billing_details jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists invoices_profile_id_idx on public.invoices (profile_id);

alter table public.invoices enable row level security;

drop policy if exists invoices_admin_all on public.invoices;
create policy invoices_admin_all on public.invoices
  for all using (public.is_admin()) with check (public.is_admin());

-- Un revendeur/client peut lire SES PROPRES factures (jamais celles d'un
-- autre) — écriture réservée aux RPC ci-dessous (security definer), jamais
-- en direct : la numérotation séquentielle sans rupture doit rester
-- garantie par un verrou serveur, pas par un insert client.
drop policy if exists invoices_owner_select on public.invoices;
create policy invoices_owner_select on public.invoices
  for select using (profile_id = auth.uid());

revoke all on public.invoices from public, authenticated;
grant select on public.invoices to authenticated;

-- Compteur de numérotation, un par année civile — verrouillé (for update)
-- au moment de générer une facture pour garantir une séquence chronologique
-- SANS RUPTURE (obligation légale), même en cas de générations concurrentes.
create table if not exists public.invoice_counters (
  year int primary key,
  last_number int not null default 0
);
alter table public.invoice_counters enable row level security;
drop policy if exists invoice_counters_admin_all on public.invoice_counters;
create policy invoice_counters_admin_all on public.invoice_counters
  for all using (public.is_admin()) with check (public.is_admin());
revoke all on public.invoice_counters from public, authenticated;

-- ----------------------------------------------------------------------------
-- generate_invoice_for_order : crée (ou renvoie, idempotent) la facture
-- d'UNE commande. Appelable par un admin (n'importe quelle commande) ou par
-- le client/revendeur propriétaire de SA PROPRE commande (placed_by_profile_id,
-- ou par email pour une commande web plus ancienne sans cet attribut).
-- ----------------------------------------------------------------------------
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

  if v_profile.legal_status = 'individual' then
    v_billing := jsonb_build_object(
      'name', trim(coalesce(v_profile.first_name, '') || ' ' || coalesce(v_profile.last_name, '')),
      'address', v_profile.address,
      'city', v_profile.city,
      'postal_code', v_profile.postal_code,
      'country', v_profile.country
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
      'country', v_profile.legal_country
    );
  end if;

  -- Numérotée sur l'année de LA VENTE (created_at de la commande), pas celle
  -- de la génération : une facture émise en rattrapage plusieurs mois après
  -- reste datée/numérotée dans la séquence de l'année où la vente a eu lieu.
  v_year := extract(year from v_order.created_at)::int;

  insert into public.invoice_counters (year, last_number) values (v_year, 0)
    on conflict (year) do nothing;

  update public.invoice_counters
  set last_number = last_number + 1
  where year = v_year
  returning last_number into v_next_number;

  v_invoice_number := 'FAC-' || v_year || '-' || lpad(v_next_number::text, 5, '0');

  insert into public.invoices (order_id, profile_id, invoice_number, total_amount, legal_status, billing_details, issued_at)
  values (p_order_id, v_profile.id, v_invoice_number, v_order.total_amount, v_profile.legal_status, v_billing, now())
  returning id into v_invoice_id;

  return jsonb_build_object('already_generated', false, 'invoice_id', v_invoice_id, 'invoice_number', v_invoice_number);
end;
$$;

grant execute on function public.generate_invoice_for_order(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- backfill_missing_invoices_for_profile : rattrapage — génère les factures
-- manquantes pour toutes les commandes payées d'un profil, typiquement
-- appelé juste après que set_reseller_legal_info (0109) a réussi. Sans
-- paramètre, cible l'appelant lui-même (auto-déclenché côté client) ; un
-- admin peut cibler n'importe quel profil.
-- ----------------------------------------------------------------------------
create or replace function public.backfill_missing_invoices_for_profile(p_profile_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target uuid := coalesce(p_profile_id, auth.uid());
  v_order_id uuid;
  v_generated int := 0;
  v_target_email text;
begin
  if v_target is null then
    raise exception 'Profil cible introuvable';
  end if;
  if not (public.is_admin() or v_target = auth.uid()) then
    raise exception 'Accès refusé';
  end if;

  select email into v_target_email from public.profiles where id = v_target;

  for v_order_id in
    select o.id
    from public.orders o
    where (o.placed_by_profile_id = v_target or o.email = v_target_email)
      and (o.payment_status in ('paid', 'succeeded') or o.status in ('confirmed', 'shipped', 'delivered'))
      and not exists (select 1 from public.invoices i where i.order_id = o.id)
  loop
    begin
      perform public.generate_invoice_for_order(v_order_id);
      v_generated := v_generated + 1;
    exception when others then
      -- Une commande individuelle en échec (ex: montant incohérent) ne doit
      -- jamais bloquer le rattrapage des autres.
      continue;
    end;
  end loop;

  return jsonb_build_object('generated', v_generated);
end;
$$;

grant execute on function public.backfill_missing_invoices_for_profile(uuid) to authenticated;

notify pgrst, 'reload schema';
