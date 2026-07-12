import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  Users,
  BarChart3,
  Settings,
  Plus,
  List,
  Archive,
  CheckCircle,
  Truck,
  UserPlus,
  Activity,
  TrendingUp,
  PieChart,
  User,
  Bell,
  Shield,
  Calculator,
  CreditCard,
  Receipt,
  Banknote,
  FileText,
  TrendingDown,
  Globe,
  Tag,
  Ticket,
  ScanLine,
  Clock,
  Gavel,
  Handshake
} from 'lucide-react';
import { MenuItem } from '../types';

export const navigationItems: MenuItem[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    path: '/dashboard',
    subItems: [
      { id: 'overview', label: 'Vue d\'ensemble', path: '/dashboard/overview', icon: Activity },
      { id: 'analytics', label: 'Analytics', path: '/dashboard/analytics', icon: TrendingUp },
      { id: 'reports', label: 'Rapports', path: '/dashboard/reports', icon: PieChart },
    ]
  },
  {
    id: 'orders',
    label: 'Commandes',
    icon: ShoppingCart,
    path: '/orders',
    subItems: [
      { id: 'all-orders', label: 'Toutes les commandes', path: '/orders/all', icon: List },
      { id: 'web-orders', label: 'Commandes site web', path: '/orders/web', icon: Globe },
      { id: 'external-orders', label: 'Commandes externes', path: '/orders/external', icon: Archive },
    ]
  },
  {
    id: 'products',
    label: 'Produits',
    icon: Package,
    path: '/products',
    subItems: [
      { id: 'tableau-de-bord', label: 'Tableau de bord', path: '/products/dashboard', icon: BarChart3 },
      { id: 'produits', label: 'Produits', path: '/products/all', icon: Package },
      { id: 'en-attente', label: 'En attente', path: '/products/pending', icon: Clock },
      { id: 'live-encheres', label: 'Live enchères', path: '/products/live-encheres', icon: Gavel },
      { id: 'scanner', label: 'Scanner', path: '/products/scanner', icon: ScanLine },
      { id: 'categories', label: 'Catégories', path: '/products/categories', icon: Archive },
      { id: 'marques', label: 'Marques', path: '/products/brands', icon: Tag },
    ]
  },
  {
    id: 'customers',
    label: 'Clients',
    icon: Users,
    path: '/customers',
    subItems: [
      { id: 'all-customers', label: 'Tous les clients', path: '/customers/all', icon: List },
      { id: 'coupons', label: 'Coupons', path: '/customers/coupons', icon: Ticket },
    ]
  },
  {
    id: 'accounting',
    label: 'Comptabilité & Finances',
    icon: Calculator,
    path: '/accounting',
    subItems: [
      { id: 'dashboard', label: 'Dashboard', path: '/accounting/dashboard', icon: BarChart3 },
      { id: 'ventes-ligne', label: 'Ventes en ligne', path: '/accounting/ventes-ligne', icon: TrendingUp },
      { id: 'depenses', label: 'Dépenses', path: '/accounting/depenses', icon: TrendingDown },
      { id: 'factures', label: 'Factures', path: '/accounting/factures', icon: FileText },
      { id: 'paiements', label: 'Paiements', path: '/accounting/paiements', icon: CreditCard },
      { id: 'rapports-financiers', label: 'Rapports financiers', path: '/accounting/rapports-financiers', icon: PieChart },
    ]
  },
  {
    id: 'b2b',
    label: 'Revendeurs',
    icon: Handshake,
    path: '/b2b',
    subItems: [
      { id: 'resellers', label: 'Revendeurs', path: '/b2b/resellers', icon: Users },
      { id: 'b2b-products', label: 'Produits B2B', path: '/b2b/products', icon: Package },
      { id: 'b2b-orders', label: 'Commandes B2B', path: '/b2b/orders', icon: ShoppingCart },
      { id: 'commissions', label: 'Chiffre d\'affaires B2B', path: '/b2b/commissions', icon: Banknote },
    ]
  },
  {
    id: 'analytics',
    label: 'Analytics',
    icon: BarChart3,
    path: '/analytics',
    subItems: [
      { id: 'sales', label: 'Ventes', path: '/analytics/sales', icon: TrendingUp },
      { id: 'traffic', label: 'Trafic', path: '/analytics/traffic', icon: Activity },
      { id: 'conversion', label: 'Conversion', path: '/analytics/conversion', icon: PieChart },
    ]
  },
  {
    id: 'settings',
    label: 'Paramètres',
    icon: Settings,
    path: '/settings',
    subItems: [
      { id: 'profile', label: 'Profil', path: '/settings/profile', icon: User },
      { id: 'users', label: 'Utilisateurs', path: '/settings/users', icon: Users },
      { id: 'notifications', label: 'Notifications', path: '/settings/notifications', icon: Bell },
      { id: 'security', label: 'Sécurité', path: '/settings/security', icon: Shield },
    ]
  },
];