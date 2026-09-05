import { LayoutGrid, PackageSearch, ShoppingBag, User, Users, Wallet } from 'lucide-react';
import { MenuItem } from '../types';

export const resellerNavigationItems: MenuItem[] = [
  { id: 'catalog', label: 'Catalogue', icon: LayoutGrid, path: '/catalog' },
  // Le suivi de livraison (statut + numéro de tracking) est intégré
  // directement dans "Mes commandes" — voir B2BOrdersList.tsx — plus
  // d'onglet séparé (ex-MyShipments.tsx/useMyShipments.ts, supprimés).
  { id: 'my-orders', label: 'Mes commandes', icon: ShoppingBag, path: '/my-orders' },
  { id: 'sourcing', label: 'Sourcing sur mesure', icon: PackageSearch, path: '/sourcing' },
  { id: 'wallet', label: 'Mon Portefeuille', icon: Wallet, path: '/wallet' },
  { id: 'profile', label: 'Mon profil', icon: User, path: '/profile' },
];

/** Visible uniquement pour le contact principal de l'entreprise (voir ResellerApp). */
export const resellerTeamNavItem: MenuItem = { id: 'team', label: 'Mon équipe', icon: Users, path: '/team' };
