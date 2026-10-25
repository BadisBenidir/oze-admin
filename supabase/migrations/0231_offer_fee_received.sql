-- ============================================================================
-- Groupe 5 « Offre 2 000 € » (0222) : les 300 € dus par le partenaire ne
-- comptent dans le CA abonnements qu'une fois reçus.
--   - community_subscription_payments.awaiting_payment : ligne de l'offre
--     créée « à percevoir » (hors CA) à l'entrée dans le groupe 5 ;
--   - admin_mark_offer_fee_received : l'admin confirme la réception
--     (paid_at = date de réception, la ligne entre dans le CA) ;
--   - sortie du groupe 5 : ligne non encore reçue supprimée, accès offert retiré.
-- Lignes existantes de l'offre : repassées « à percevoir ».
-- ============================================================================

alter table public.community_subscription_payments
  add column if not exists awaiting_payment boolean not null default false;

update public.community_subscription_payments
set awaiting_payment = true
where billing_reason = 'partner_offer';

create or replace function public.reseller_contacts_group5_fee()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.member_group = 5 and (tg_op = 'INSERT' or old.member_group is distinct from 5) and not new.is_primary then
    insert into public.community_subscription_payments (
      stripe_invoice_id, reseller_id, contact_id, profile_id, amount, currency, plan, billing_reason, paid_at, awaiting_payment
    )
    values (
      'offre5-' || new.id, new.reseller_id, new.id, new.profile_id, public.community_offer_fee(), 'eur',
      'offre_2000', 'partner_offer', now(), true
    )
    on conflict (stripe_invoice_id) do nothing;
  elsif tg_op = 'UPDATE' and old.member_group = 5 and new.member_group is distinct from 5 then
    delete from public.community_subscription_payments
    where stripe_invoice_id = 'offre5-' || new.id and awaiting_payment;
  end if;
  return new;
end;
$$;

-- Sortie du groupe 5 : fin de l'accès offert.
create or replace function public.reseller_contacts_group5_access()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.member_group = 5 and (tg_op = 'INSERT' or old.member_group is distinct from 5) and not new.is_primary then
    new.free_access_until := coalesce(new.created_at, now()) + interval '6 months';
  elsif tg_op = 'UPDATE' and old.member_group = 5 and new.member_group is distinct from 5 then
    new.free_access_until := null;
  end if;
  return new;
end;
$$;

create or replace function public.admin_mark_offer_fee_received(p_payment_id uuid, p_received boolean default true)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Réservé aux administrateurs';
  end if;
  update public.community_subscription_payments
  set awaiting_payment = not p_received,
      paid_at = case when p_received then now() else paid_at end
  where id = p_payment_id and billing_reason = 'partner_offer';
  if not found then
    raise exception 'Paiement introuvable';
  end if;
end;
$$;

grant execute on function public.admin_mark_offer_fee_received(uuid, boolean) to authenticated;

-- Membres déjà sortis du groupe 5 (ex. remis en groupe 1) : nettoyage.
delete from public.community_subscription_payments p
using public.reseller_contacts rc
where p.billing_reason = 'partner_offer' and p.awaiting_payment
  and rc.id = p.contact_id and rc.member_group is distinct from 5;

update public.reseller_contacts
set free_access_until = null
where member_group is distinct from 5 and free_access_until is not null;

notify pgrst, 'reload schema';
