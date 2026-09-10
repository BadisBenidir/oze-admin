import { useCallback, useEffect, useState } from 'react';
import { MenuItem } from '../types';

interface ResolvedRoute {
  tab: string;
  subTab: string;
}

/** Cherche d'abord une correspondance EXACTE sur un sous-item (ex:
 * /orders/all), puis sur l'item racine lui-même (ex: /orders, qui retombe
 * alors sur son premier sous-item) — jamais l'inverse, sinon /orders
 * matcherait avant /orders/b2b par préfixe. */
const resolvePathToRoute = (items: MenuItem[], pathname: string): ResolvedRoute | null => {
  for (const item of items) {
    if (item.subItems) {
      const sub = item.subItems.find((s) => s.path === pathname);
      if (sub) return { tab: item.id, subTab: sub.id };
    }
  }
  for (const item of items) {
    if (item.path === pathname) {
      return { tab: item.id, subTab: item.subItems?.[0]?.id || '' };
    }
  }
  return null;
};

const resolveRouteToPath = (items: MenuItem[], tab: string, subTab: string): string | null => {
  const item = items.find((i) => i.id === tab);
  if (!item) return null;
  if (subTab && item.subItems) {
    const sub = item.subItems.find((s) => s.id === subTab);
    if (sub) return sub.path;
  }
  return item.path;
};

/**
 * Onglet actif reflété dans l'URL réelle (pushState/popstate), à partir de
 * la config de navigation (les `path` de navigation.ts/resellerNavigation.ts
 * existaient déjà mais n'étaient jusqu'ici jamais lus ni écrits) — un
 * rechargement de page ou un lien partagé retombe désormais sur le bon
 * onglet au lieu de toujours revenir à l'accueil. Reste volontairement sans
 * dépendance à react-router, dans le même esprit que le routage déjà en
 * place pour les 3 routes "réelles" du portail revendeur (voir ResellerApp).
 *
 * `navigationItems` peut être fourni après coup (ex: ResellerApp calcule sa
 * liste après avoir chargé `profile`) : la résolution initiale se contente
 * alors du chemin par défaut, corrigée dès que la vraie liste arrive.
 */
export const useNavigation = (navigationItems: MenuItem[] = [], defaultTab = 'dashboard') => {
  const resolveInitial = useCallback((): ResolvedRoute => {
    const resolved = navigationItems.length > 0 ? resolvePathToRoute(navigationItems, window.location.pathname) : null;
    if (resolved) return resolved;
    const fallbackItem = navigationItems.find((i) => i.id === defaultTab);
    return { tab: defaultTab, subTab: fallbackItem?.subItems?.[0]?.id || '' };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [route, setRoute] = useState<ResolvedRoute>(resolveInitial);

  // Corrige la résolution initiale si la liste de navigation change de forme
  // après le tout premier rendu (cas ResellerApp : l'item "Mon équipe"
  // n'apparaît qu'une fois `profile` chargé) — un rechargement direct sur
  // /team avant que `profile` soit connu retombait sinon sur `defaultTab`
  // sans jamais se corriger. `setRoute` ne fait rien si déjà exact, donc pas
  // de boucle même si `navigationItems` change de référence à chaque rendu.
  useEffect(() => {
    if (navigationItems.length === 0) return;
    const resolved = resolvePathToRoute(navigationItems, window.location.pathname);
    if (resolved && (resolved.tab !== route.tab || resolved.subTab !== route.subTab)) {
      setRoute(resolved);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigationItems.length]);

  useEffect(() => {
    const onPopState = () => {
      const resolved = resolvePathToRoute(navigationItems, window.location.pathname);
      if (resolved) setRoute(resolved);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigationItems]);

  const navigateTo = useCallback(
    (tab: string, subTab?: string) => {
      const resolvedSubTab = subTab || '';
      setRoute({ tab, subTab: resolvedSubTab });
      const path = resolveRouteToPath(navigationItems, tab, resolvedSubTab);
      if (path && path !== window.location.pathname) {
        window.history.pushState({}, '', path);
      }
    },
    [navigationItems]
  );

  return {
    activeTab: route.tab,
    activeSubTab: route.subTab,
    navigateTo,
  };
};
