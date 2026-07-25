-- ============================================================================
-- Module B2B Revendeurs — 43 : rend la suppression des codes promos et des
-- revendeurs réellement fonctionnelle, sans détruire l'historique comptable.
--
-- - promo_codes.deleted_at : soft-delete. Un code jamais utilisé peut encore
--   être supprimé physiquement (DELETE réel) ; un code déjà utilisé dans une
--   commande (orders.promo_code_id le référence, sans ON DELETE) ne peut pas
--   être supprimé sans casser cette référence — on le masque à la place.
-- - resellers.status gagne 'deleted' : un revendeur "supprimé" depuis
--   l'admin ne l'est jamais physiquement dès qu'il a des commandes, un
--   portefeuille ou des cadeaux fidélité (mêmes contraintes FK qu'au-dessus,
--   voir orders.reseller_id / wallet_transactions.reseller_id /
--   loyalty_gifts.reseller_id, aucune n'a ON DELETE CASCADE). Il est
--   désactivé : masqué de la liste admin, accès Auth de tous ses contacts
--   révoqué (voir edge function deactivate-reseller), mais commandes/
--   portefeuille/cadeaux restent intacts pour la compta et les rapports B2B.
-- ============================================================================

alter table public.promo_codes add column if not exists deleted_at timestamptz;

alter table public.resellers drop constraint if exists resellers_status_check;
alter table public.resellers
  add constraint resellers_status_check check (status in ('pending', 'active', 'suspended', 'deleted'));

notify pgrst, 'reload schema';
