import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  Users,
  BarChart3,
  Plus,
  List,
  Archive,
  CheckCircle,
  Truck,
  UserPlus,
  Activity,
  TrendingUp,
  PieChart,
  Calculator,
  Receipt,
  Banknote,
  Globe,
  Tag,
  Ticket,
  ScanLine,
  Clock,
  Gavel,
  Handshake,
  Rocket,
  PackageCheck,
  PackageSearch,
  Gift
} from 'lucide-react';
import { MenuItem } from '../types';

export const navigationItems: MenuItem[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    path: '/tableau-de-bord',
    subItems: [
      { id: 'overview', label: 'Vue d\'ensemble', path: '/tableau-de-bord/vue-ensemble', icon: Activity },
      { id: 'analytics', label: 'Analytics', path: '/tableau-de-bord/analytique', icon: TrendingUp },
      { id: 'reports', label: 'Rapports', path: '/tableau-de-bord/rapports', icon: PieChart },
    ]
  },
  {
    id: 'orders',
    label: 'Commandes',
    icon: ShoppingCart,
    path: '/commandes',
    subItems: [
      { id: 'all-orders', label: 'Toutes les commandes', path: '/commandes/toutes', icon: List },
      { id: 'web-orders', label: 'Commandes site web', path: '/commandes/site-web', icon: Globe },
      { id: 'b2b-orders', label: 'Commandes B2B', path: '/commandes/b2b', icon: Handshake },
      { id: 'reception', label: 'Vue Réception', path: '/commandes/reception', icon: PackageCheck },
      { id: 'shipment-requests', label: 'Demandes de livraison', path: '/commandes/demandes-livraison', icon: Truck },
    ]
  },
  {
    id: 'products',
    label: 'Produits',
    icon: Package,
    path: '/produits',
    subItems: [
      { id: 'tableau-de-bord', label: 'Tableau de bord', path: '/produits/tableau-de-bord', icon: BarChart3 },
      { id: 'produits', label: 'Produits', path: '/produits/tous', icon: Package },
      { id: 'en-attente', label: 'En attente', path: '/produits/en-attente', icon: Clock },
      { id: 'live-encheres', label: 'Live enchères', path: '/produits/live-encheres', icon: Gavel },
      { id: 'scanner', label: 'Scanner', path: '/produits/scanner', icon: ScanLine },
      { id: 'categories', label: 'Catégories', path: '/produits/categories', icon: Archive },
      { id: 'marques', label: 'Marques', path: '/produits/marques', icon: Tag },
    ]
  },
  {
    id: 'customers',
    label: 'Clients',
    icon: Users,
    path: '/clients',
    subItems: [
      { id: 'all-customers', label: 'Tous les clients', path: '/clients/tous', icon: List },
      { id: 'coupons', label: 'Coupons', path: '/clients/coupons', icon: Ticket },
    ]
  },
  {
    id: 'accounting',
    label: 'Comptabilité & Finances',
    icon: Calculator,
    path: '/comptabilite',
    // Page unique désormais entièrement pilotée par ses propres onglets
    // internes (Dashboard Global / B2C / B2B / Lives) et sa barre d'outils
    // de période — voir Accounting.tsx. Un seul sous-item requis pour rester
    // compatible avec le mécanisme de sélection de la barre latérale
    // (AdminApp.tsx attend toujours au moins un subItems[0]).
    subItems: [
      { id: 'overview', label: 'Comptabilité & Finances', path: '/comptabilite/vue-ensemble', icon: BarChart3 },
    ]
  },
  {
    id: 'b2b',
    label: 'Espace B2B',
    sidebarLabel: 'Gestion B2B',
    icon: Handshake,
    path: '/espace-b2b',
    subItems: [
      { id: 'resellers', label: 'Partenaires', path: '/espace-b2b/partenaires', icon: Users },
      { id: 'b2b-products', label: 'Produits B2B', path: '/espace-b2b/produits', icon: Package },
      { id: 'drops', label: 'Drops B2B', path: '/espace-b2b/drops', icon: Rocket },
      { id: 'sourcing', label: 'Sourcing sur mesure', path: '/espace-b2b/sourcing', icon: PackageSearch },
      { id: 'auctions', label: 'Enchères B2B', path: '/espace-b2b/encheres', icon: Gavel },
      { id: 'promo-codes', label: 'Codes Promos', path: '/espace-b2b/codes-promo', icon: Ticket },
      { id: 'commissions', label: 'Chiffre d\'affaires B2B', path: '/espace-b2b/chiffre-affaires', icon: Banknote },
      { id: 'gift-rewards', label: 'Portefeuilles offerts', path: '/espace-b2b/portefeuilles-offerts', icon: Gift },
    ]
  },
];