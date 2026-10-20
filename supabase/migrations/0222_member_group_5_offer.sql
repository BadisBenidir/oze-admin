-- ============================================================================
-- Groupe 5 — « Offre 2 000 € » d'une communauté partenaire (ex. Aurel Vinted).
--
-- Les membres qui prennent l'offre à 2 000 € du partenaire rejoignent le
-- groupe 5 : le partenaire verse 300 € à OZË PARIS par membre, et le membre a
-- 6 mois d'accès offert à la plateforme (jamais coupé pendant ce temps).
--   - groupes d'accès 1..5 (0211, 0212) ;
--   - reseller_invite_links.member_group : lien d'invitation qui classe
--     directement le nouveau membre dans un groupe (lien « Offre 2 000 € »,
--     partagé par le partenaire au moment du paiement) ;
--   - reseller_contacts.free_access_until : fin de l'accès offert ;
--   - entrée dans le groupe 5 (lien ou classement manuel), une seule fois par
--     membre : accès offert 6 mois + 300 € dans community_subscription_payments
--     (CA abonnement de la communauté, 0217) ;
--   - community_access_blocked (0221) : jamais pendant l'accès offert.
-- ============================================================================

alter table public.reseller_contacts drop constraint if exists reseller_contacts_member_group_check;
alter table public.reseller_contacts add constraint reseller_contacts_member_group_check
  check (member_group is null or member_group between 1 and 5);

alter table public.community_group_prices drop constraint if exists community_group_prices_member_group_check;
alter table public.community_group_prices add constraint community_group_prices_member_group_check
  check (member_group between 1 and 5);

alter table public.reseller_contacts add column if not exists free_access_until timestamptz;

alter table public.reseller_invite_links add column if not exists member_group smallint
  check (member_group is null or member_group between 1 and 5);

-- Montant versé par le partenaire à OZË PARIS pour chaque membre de l'offre.
create or replace function public.community_offer_fee()
returns numeric
language sql
immutable
as $$ select 300.00::numeric $$;

-- Avant écriture : accès offert 6 mois à l'entrée dans le groupe 5.
create or replace function public.reseller_contacts_group5_access()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.member_group = 5 and (tg_op = 'INSERT' or old.member_group is distinct from 5)
     and not new.is_primary and new.free_access_until is null then
    new.free_access_until := now() + interval '6 months';
  end if;
  return new;
end;
$$;

-- Après écriture (le membre existe) : 300 € au CA de la communauté, une seule fois par membre.
create or replace function public.reseller_contacts_group5_fee()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.member_group = 5 and (tg_op = 'INSERT' or old.member_group is distinct from 5) and not new.is_primary then
    insert into public.community_subscription_payments (
      stripe_invoice_id, reseller_id, contact_id, profile_id, amount, currency, plan, billing_reason, paid_at
    )
    values (
      'offre5-' || new.id, new.reseller_id, new.id, new.profile_id, public.community_offer_fee(), 'eur',
      'offre_2000', 'partner_offer', now()
    )
    on conflict (stripe_invoice_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists reseller_contacts_group5_access on public.reseller_contacts;
create trigger reseller_contacts_group5_access
  before insert or update of member_group on public.reseller_contacts
  for each row execute function public.reseller_contacts_group5_access();

drop trigger if exists reseller_contacts_group5_fee on public.reseller_contacts;
create trigger reseller_contacts_group5_fee
  after insert or update of member_group on public.reseller_contacts
  for each row execute function public.reseller_contacts_group5_fee();

-- Classement d'un membre : groupes 1 à 5.
create or replace function public.set_member_group(p_contact_id uuid, p_group smallint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contact record;
begin
  if p_group is not null and (p_group < 1 or p_group > 5) then
    raise exception 'Groupe invalide';
  end if;

  select * into v_contact from public.reseller_contacts where id = p_contact_id;
  if not found then
    raise exception 'Membre introuvable';
  end if;

  if not public.is_admin() and not exists (
    select 1 from public.reseller_contacts me
    where me.profile_id = auth.uid() and me.reseller_id = v_contact.reseller_id and me.is_primary
  ) then
    raise exception 'Seul le contact principal de l''entreprise peut classer ses membres';
  end if;
  if v_contact.is_primary and not public.is_admin() then
    raise exception 'Le contact principal ne se classe pas lui-même';
  end if;

  update public.reseller_contacts
  set member_group = p_group, member_group_updated_at = now()
  where id = p_contact_id;

  return jsonb_build_object('contact_id', p_contact_id, 'member_group', p_group);
end;
$$;

create or replace function public.community_access_blocked(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.reseller_contacts rc
    join public.resellers rs on rs.id = rc.reseller_id
    where rc.profile_id = p_user_id
      and not rc.is_primary
      and rc.member_group is not null
      and rs.account_type is distinct from 'subscriber'
      and coalesce(rc.community_sub_status, '') not in ('active', 'trialing', 'past_due')
      -- Accès offert (groupe 5, offre 2 000 €) : jamais coupé avant la fin.
      and (rc.free_access_until is null or rc.free_access_until <= now())
      and coalesce((
        select p.monthly_price
        from public.community_group_prices p
        where p.reseller_id = rc.reseller_id
          and p.member_group = rc.member_group
          and p.effective_from <= current_date
        order by p.effective_from desc
        limit 1
      ), 0) > 0
  );
$$;

notify pgrst, 'reload schema';
