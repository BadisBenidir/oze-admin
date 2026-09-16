-- ============================================================================
-- Corrige une deuxième casse découverte en creusant le bug de la jauge de
-- fidélité (0131) : depuis 0101/0111, le suivi des portefeuilles offerts
-- passe par b2b_gift_rewards, une table strictement ADMIN (policy
-- b2b_gift_rewards_admin_all, aucune policy select pour le revendeur
-- concerné). Or le bandeau "Découvrir mon cadeau !" / "Cadeaux en attente
-- d'envoi" côté revendeur (WalletPage.tsx) lit encore l'ANCIENNE table
-- loyalty_gifts (0040), dans laquelle plus rien n'est écrit depuis 0101 —
-- un revendeur qui débloque un cadeau n'a donc plus AUCUN moyen de le voir,
-- même quand le calcul est correct (voir credit_wallet_topup).
--
-- Ajoute simplement une policy select scoped à son propre profil : le
-- reste (générer le bandeau générique côté client) se fait dans
-- useWallet.ts / WalletPage.tsx, sans donner au revendeur le moindre droit
-- d'écriture (insert/update/delete restent admin-only via
-- b2b_gift_rewards_admin_all, seule policy permissive pour ces opérations).
-- ============================================================================

drop policy if exists b2b_gift_rewards_reseller_select_own on public.b2b_gift_rewards;
create policy b2b_gift_rewards_reseller_select_own on public.b2b_gift_rewards
  for select using (profile_id = auth.uid());

notify pgrst, 'reload schema';
