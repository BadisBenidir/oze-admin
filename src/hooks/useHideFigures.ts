import { useSyncExternalStore } from 'react';

/**
 * « Masquer les chiffres » de l'admin (écran partagé, en public) : un seul
 * réglage pour toutes les pages — CA et compteurs du Dashboard, prix
 * d'achat, coûts et marges des écrans produits / B2B. Interrupteur dans
 * l'en-tête (layHeader.tsx). Préférence propre à ce navigateur (stockage
 * local, parfois indisponible : le masquage dure alors la session),
 * synchronisée entre les composants et les onglets.
 */

const KEY = 'oze:dashboard-hide-figures';
const EVENT = 'oze:hide-figures-change';
export const HIDDEN_FIGURE = '••••';

let memoryValue = false;

const read = (): boolean => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return memoryValue;
  }
};

const subscribe = (callback: () => void) => {
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) callback();
  };
  window.addEventListener(EVENT, callback);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(EVENT, callback);
    window.removeEventListener('storage', onStorage);
  };
};

export const setHideFigures = (hidden: boolean) => {
  memoryValue = hidden;
  try {
    localStorage.setItem(KEY, hidden ? '1' : '0');
  } catch {
    // stockage indisponible : valeur gardée en mémoire pour la session
  }
  window.dispatchEvent(new Event(EVENT));
};

export const useHideFigures = () => {
  const hidden = useSyncExternalStore(subscribe, read, () => false);
  /** Valeur à afficher, ou « •••• » quand les chiffres sont masqués. */
  const show = <T,>(value: T): T | string => (hidden ? HIDDEN_FIGURE : value);
  return { hidden, show, toggle: () => setHideFigures(!hidden) };
};
