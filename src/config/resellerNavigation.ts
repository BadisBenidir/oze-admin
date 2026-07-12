import { LayoutGrid, ShoppingBag, User, Users } from 'lucide-react';
import { MenuItem } from '../types';

export const resellerNavigationItems: MenuItem[] = [
  { id: 'catalog', label: 'Catalogue', icon: LayoutGrid, path: '/catalog' },
  { id: 'my-orders', label: 'Mes commandes', icon: ShoppingBag, path: '/my-orders' },
  { id: 'profile', label: 'Mon profil', icon: User, path: '/profile' },
];

/** Visible uniquement pour le contact principal de l'entreprise (voir ResellerApp). */
export const resellerTeamNavItem: MenuItem = { id: 'team', label: 'Mon équipe', icon: Users, path: '/team' };
