import { Gavel, LayoutGrid, PackageSearch, ShoppingBag, User, Users, Wallet } from 'lucide-react';
import { MenuItem } from '../types';

export const resellerNavigationItems: MenuItem[] = [
  // /catalogue est aussi le préfixe de la fiche produit (/catalogue/:id,
  // voir parseProductId dans ResellerApp.tsx) — même racine, cohérent.
  { id: 'catalog', label: 'Catalogue', icon: LayoutGrid, path: '/catalogue' },
  // Le suivi de livraison (statut + numéro de tracking) est intégré
  // directement dans "Mes commandes" — voir B2BOrdersList.tsx — plus
  // d'onglet séparé (ex-MyShipments.tsx/useMyShipments.ts, supprimés).
  { id: 'my-orders', label: 'Mes commandes', icon: ShoppingBag, path: '/mes-commandes' },
  { id: 'sourcing', label: 'Sourcing sur mesure', icon: PackageSearch, path: '/sourcing-sur-mesure' },
  // Onglet désormais visible pour tous (lancement) — le gate par code
  // d'accès (voir AuctionAccessGate/useAuctionAccess) reste affiché tant que
  // la fonctionnalité n'est pas officiellement ouverte à tous.
  { id: 'auctions', label: 'Enchères', icon: Gavel, path: '/encheres' },
  { id: 'wallet', label: 'Mon Portefeuille', icon: Wallet, path: '/portefeuille' },
  { id: 'profile', label: 'Mon profil', icon: User, path: '/mon-profil' },
];

/** Visible uniquement pour le contact principal de l'entreprise (voir ResellerApp). */
export const resellerTeamNavItem: MenuItem = { id: 'team', label: 'Mon équipe', icon: Users, path: '/mon-equipe' };
