import { Gavel, LayoutGrid, Zap, PackageSearch, ShoppingBag, TrendingUp, User, Users, Wallet } from 'lucide-react';
import { MenuItem } from '../types';

export const resellerNavigationItems: MenuItem[] = [
  // /catalogue est aussi le préfixe de la fiche produit (/catalogue/:id,
  // voir parseProductId dans ResellerApp.tsx) — même racine, cohérent.
  { id: 'catalog', label: 'Catalogue', icon: LayoutGrid, path: '/catalogue' },
  // Articles marqués achat immédiat par l'admin (products.instant_buy, 0253).
  { id: 'instant-buy', label: 'Achat Immédiat', icon: Zap, path: '/achat-immediat' },
  // Le suivi de livraison (statut + numéro de tracking) est intégré
  // directement dans "Mes commandes" — voir B2BOrdersList.tsx — plus
  // d'onglet séparé (ex-MyShipments.tsx/useMyShipments.ts, supprimés).
  // « Mes commandes », « Mon Portefeuille » et « Mon profil » : dans le menu
  // « Mon compte » de l'en-tête (resHeader.tsx), plus dans la barre — mêmes URLs.
  { id: 'my-orders', label: 'Mes commandes', icon: ShoppingBag, path: '/mes-commandes', hidden: true },
  { id: 'sourcing', label: 'Sourcing sur mesure', icon: PackageSearch, path: '/sourcing-sur-mesure' },
  { id: 'auctions', label: 'Enchères', icon: Gavel, path: '/encheres' },
  { id: 'market-results', label: 'Résultats de ventes', icon: TrendingUp, path: '/ventes' },
  { id: 'wallet', label: 'Mon Portefeuille', icon: Wallet, path: '/portefeuille', hidden: true },
  { id: 'profile', label: 'Mon profil', icon: User, path: '/mon-profil', hidden: true },
];

/** Visible uniquement pour le contact principal de l'entreprise (voir ResellerApp). */
export const resellerTeamNavItem: MenuItem = { id: 'team', label: 'Mon équipe', icon: Users, path: '/mon-equipe', hidden: true };
