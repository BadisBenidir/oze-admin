-- ============================================================================
-- Correctif : 0104 posait la RLS (policies admin_all / reseller_select /
-- reseller_insert) mais n'accordait que SELECT au rôle `authenticated` sur
-- auction_sessions/auction_items/auction_bids, et RIEN du tout sur
-- auction_access. En Postgres, un GRANT de base est un préalable à la RLS,
-- pas remplacé par elle : même un admin (qui n'est qu'un `authenticated`
-- ordinaire, is_admin() est une vérification applicative, pas un rôle
-- Postgres séparé) se voyait donc refuser toute création de session/lot/
-- accès ("permission denied for table auction_sessions").
--
-- Même principe déjà appliqué à b2b_gift_rewards (0101) : GRANT large sur
-- le rôle, la restriction réelle vient uniquement des policies RLS
-- ci-dessous (admin_all → tout ; reseller → lecture seule, ou insertion de
-- ses propres enchères pour auction_bids ; aucune policy reseller pour
-- auction_access → un revendeur reste bloqué dessus malgré le GRANT).
-- ============================================================================

grant select, insert, update, delete on public.auction_sessions to authenticated;
grant select, insert, update, delete on public.auction_items to authenticated;
grant select, insert, update, delete on public.auction_bids to authenticated;
grant select, insert, update, delete on public.auction_access to authenticated;

notify pgrst, 'reload schema';
