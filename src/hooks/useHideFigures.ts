import { useSyncExternalStore } from 'react';

/**
 * « Masquer les chiffres » de l'admin (écran partagé, en public) : un seul
 * interrupteur pour toutes les pages (en-tête, layHeader.tsx). Préférence
 * propre à ce navigateur (stockage local, parfois indisponible : le masquage
 * dure alors la session), synchronisée entre les composants et les onglets.
 *
 * Trois familles de chiffres, pour les droits des employés (0208/0209) :
 *   - 'costs'   : prix d'achat, coûts, marges (défaut) ;
 *   - 'revenue' : chiffre d'affaires TOTAL (carte CA du Dashboard, CA B2B) ;
 *   - 'detail'  : montants unitaires (une vente, un rechargement…) — jamais
 *                 imposé à un employé, masqué seulement par l'interrupteur.
 * Un employé sans le droit correspondant a cette famille masquée d'office.
 */

export type FigureKind = 'costs' | 'revenue' | 'detail';

const KEY = 'oze:dashboard-hide-figures';
const EVENT = 'oze:hide-figures-change';
export const HIDDEN_FIGURE = '••••';

let memoryValue = false;
const forced: Record<FigureKind, boolean> = { costs: false, revenue: false, detail: false };

const readManual = (): boolean => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return memoryValue;
  }
};

const readers: Record<FigureKind, () => boolean> = {
  costs: () => forced.costs || readManual(),
  revenue: () => forced.revenue || readManual(),
  detail: () => readManual(),
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

/** Masquage imposé par les droits de l'employé connecté (AdminApp.tsx). */
export const setForcedHideFigures = (value: Partial<Record<FigureKind, boolean>>) => {
  let changed = false;
  for (const kind of Object.keys(value) as FigureKind[]) {
    if (forced[kind] !== Boolean(value[kind])) {
      forced[kind] = Boolean(value[kind]);
      changed = true;
    }
  }
  if (changed) window.dispatchEvent(new Event(EVENT));
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

export const useHideFigures = (kind: FigureKind = 'costs') => {
  const hidden = useSyncExternalStore(subscribe, readers[kind], () => false);
  const manual = useSyncExternalStore(subscribe, readManual, () => false);
  /** Valeur à afficher, ou « •••• » quand les chiffres sont masqués. */
  const show = <T,>(value: T): T | string => (hidden ? HIDDEN_FIGURE : value);
  // Interrupteur inutile quand tout est déjà masqué d'office.
  const locked = forced.costs && forced.revenue;
  return { hidden, manualHidden: manual, show, locked, toggle: () => (locked ? undefined : setHideFigures(!manual)) };
};
