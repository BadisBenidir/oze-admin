-- ============================================================================
-- Abonné dont l'abonnement est terminé (resellers.status = 'suspended',
-- abonnement Stripe plus en cours) : l'espace pro reste ouvert en
-- consultation — commandes, factures, portefeuille, profil — et il peut
-- toujours demander la livraison des pièces déjà payées (stockées chez OZË
-- ou en cours d'importation). Catalogue, drops, enchères et sourcing restent
-- fermés : current_reseller_id() (achats) n'est pas modifié.
--
-- current_reseller_id_incl_ended() : même résultat que current_reseller_id(),
-- plus l'abonné terminé — utilisé uniquement par la demande de livraison
-- (b2b-request-delivery-checkout).
-- ============================================================================

create or replace function public.current_reseller_id_incl_ended()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select rc.reseller_id
  from public.reseller_contacts rc
  join public.resellers rs on rs.id = rc.reseller_id
  where rc.profile_id = auth.uid()
    and (
      rs.status in ('active', 'discovery')
      or (
        rs.status = 'suspended'
        and rs.account_type = 'subscriber'
        and coalesce(rs.subscription_status, '') not in ('active', 'trialing', 'past_due')
      )
    )
  order by (rs.status in ('active', 'discovery')) desc
  limit 1;
$$;

revoke all on function public.current_reseller_id_incl_ended() from public, anon;
grant execute on function public.current_reseller_id_incl_ended() to authenticated;

notify pgrst, 'reload schema';
