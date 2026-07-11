export interface User {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'manager' | 'user';
  avatar?: string;
}

export interface Product {
  id: string;
  name: string;
  price: number;
  category: string;
  stock: number;
  status: 'active' | 'inactive' | 'draft';
  image: string;
  description: string;
  createdAt: string;
}

export interface Order {
  id: string;
  customerName: string;
  customerEmail: string;
  total: number;
  status: 'pending' | 'confirmed' | 'shipped' | 'delivered' | 'cancelled' | 'refunded';
  items: number;
  date: string;
  source?: 'web' | 'external';
  platform?: string;
}

// Types étendus pour les vraies données de la base
export interface DatabaseOrder {
  id: string;
  order_number: string;
  email: string;
  status: string;
  total_amount: number;
  subtotal: number;
  shipping_cost: number;
  currency: string;
  payment_status: string;
  shipping_address: any;
  billing_address: any;
  created_at: string;
  updated_at: string;
  user_id?: string;
  customer_id?: string;
  customer_name?: string;
  items_count: number;
  source: 'web' | 'external';
}

export interface Customer {
  id: string;
  name: string;
  email: string;
  totalOrders: number;
  totalSpent: number;
  status: 'active' | 'inactive';
  joinDate: string;
}

export interface MenuItem {
  id: string;
  label: string;
  icon: React.ComponentType;
  path: string;
  subItems?: SubMenuItem[];
}

export interface SubMenuItem {
  id: string;
  label: string;
  path: string;
  icon?: React.ComponentType;
}