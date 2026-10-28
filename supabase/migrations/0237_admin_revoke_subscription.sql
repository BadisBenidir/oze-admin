-- ============================================================================
-- Résiliation immédiate d'un abonnement par l'admin (abonné Club ou membre de
-- communauté), remboursée au prorata du temps non utilisé
-- (Edge Function admin-cancel-subscription).
--   - reseller_contacts.access_revoked_at : accès retiré par l'admin. Le
--     membre garde son espace en consultation (commandes, factures,
--     portefeuille, profil) ; catalogue, drops, enchères et sourcing lui sont
--     fermés, et community_access_blocked refuse côté serveur panier,
--     paiement, enchère et validation de sourcing (0221, 0228) ;
--   - admin_restore_access : rend l'accès. Un abonné Club repasse par la page
--     de réabonnement (statut 'suspended', SubscriptionGate).
-- ============================================================================

alter table public.reseller_contacts add column if not exists access_revoked_at timestamptz;

create or replace function public.community_access_blocked(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.reseller_contacts rc
    where rc.profile_id = p_user_id and rc.access_revoked_at is not null
  )
  or exists (
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

create or replace function public.admin_restore_access(p_contact_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contact record;
begin
  if not public.is_admin() then
    raise exception 'Accès refusé : réservé aux administrateurs';
  end if;
  select rc.*, rs.account_type into v_contact
  from public.reseller_contacts rc join public.resellers rs on rs.id = rc.reseller_id
  where rc.id = p_contact_id;
  if not found then
    raise exception 'Membre introuvable';
  end if;

  if v_contact.account_type = 'subscriber' then
    -- Abonné Club : tout le compte, retour à la page de réabonnement.
    update public.reseller_contacts set access_revoked_at = null where reseller_id = v_contact.reseller_id;
    update public.resellers set status = 'suspended'
    where id = v_contact.reseller_id and coalesce(subscription_status, '') not in ('active', 'trialing', 'past_due');
  else
    update public.reseller_contacts set access_revoked_at = null where id = p_contact_id;
  end if;
end;
$$;

grant execute on function public.admin_restore_access(uuid) to authenticated;

notify pgrst, 'reload schema';
