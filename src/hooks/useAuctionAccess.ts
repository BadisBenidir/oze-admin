import { useCallback, useEffect, useState } from 'react';

/** Code d'accès à la session d'accès anticipé des enchères — configurable
 * via VITE_AUCTION_ACCESS_PASSWORD (repris au build, voir vite.config /
 * .env), avec repli sur cette valeur codée le temps des tests privés si la
 * variable n'est pas définie. Ce n'est PAS une mesure de sécurité réelle
 * (chaîne compilée dans le bundle JS, lisible par n'importe qui) : la
 * confidentialité réelle vient de la RLS Supabase (voir
 * 0104_auction_system.sql), qui exige un vrai compte revendeur — ce code
 * ne sert qu'à cacher l'entrée de la fonctionnalité aux revendeurs
 * normaux tant qu'elle n'est pas officiellement lancée. */
export const AUCTION_ACCESS_CODE = (import.meta.env.VITE_AUCTION_ACCESS_PASSWORD as string | undefined) || 'OZE2026';

// v2 (pas juste "oze_auction_unlocked_") : invalide volontairement tout
// déverrouillage posé sous l'ancien mode caché (cadenas discret, avant que
// l'onglet "Enchères" devienne visible dans la nav) — sinon un revendeur qui
// avait testé le cadenas pendant la période privée retombait directement
// dans la page sans jamais voir le nouveau gate, code d'accès y compris.
const STORAGE_PREFIX = 'oze_auction_unlocked_v2_';

/** Déverrouillage local de l'accès anticipé aux enchères — même convention
 * que useB2BCart.ts (clé localStorage brute préfixée par profile.id, pas de
 * hook wrapper générique dans ce repo). Un flag par profil : le
 * déverrouillage d'un sous-compte ne fuite jamais vers un autre sur le
 * même navigateur. */
export const useAuctionAccess = (profileId?: string | null) => {
  const storageKey = profileId ? STORAGE_PREFIX + profileId : null;
  const [unlocked, setUnlocked] = useState(false);

  useEffect(() => {
    if (!storageKey) {
      setUnlocked(false);
      return;
    }
    try {
      setUnlocked(localStorage.getItem(storageKey) === 'true');
    } catch {
      setUnlocked(false);
    }
  }, [storageKey]);

  const tryUnlock = useCallback(
    (code: string): boolean => {
      if (code.trim() !== AUCTION_ACCESS_CODE) return false;
      try {
        if (storageKey) localStorage.setItem(storageKey, 'true');
      } catch {
        // Stockage indisponible (navigation privée stricte...) : le
        // déverrouillage reste valable pour la session React en cours.
      }
      setUnlocked(true);
      return true;
    },
    [storageKey]
  );

  return { unlocked, tryUnlock };
};
