import { supabase } from '../lib/supabase';
import type { Order } from '../types';

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
  stripe_session_id?: string;
  stripe_payment_intent_id?: string;
  // Sendcloud (expédition)
  sendcloud_parcel_id?: string | null;
  label_url?: string | null;
  tracking_number?: string | null;
  tracking_url?: string | null;
}

export interface DatabaseOrderItem {
  id: string;
  order_id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  product_snapshot: any;
  created_at: string;
}

export interface OrderWithItems extends DatabaseOrder {
  order_items: DatabaseOrderItem[];
  customer_name?: string;
  items_count: number;
  source: 'web' | 'external';
}

class OrderService {
  async getAllOrders(): Promise<OrderWithItems[]> {
    const { data: orders, error } = await supabase
      .from('orders')
      .select(`
        *,
        order_items (*)
      `)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching orders:', error);
      throw error;
    }

    return this.formatOrders(orders || []);
  }

  async getOrdersBySource(source: 'web' | 'external'): Promise<OrderWithItems[]> {
    // Pour l'instant, toutes les commandes de la BDD sont des commandes web
    // car elles viennent du checkout Stripe. Les commandes externes 
    // seront ajoutées manuellement plus tard
    if (source === 'external') {
      return [];
    }

    const { data: orders, error } = await supabase
      .from('orders')
      .select(`
        *,
        order_items (*)
      `)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching orders by source:', error);
      throw error;
    }

    return this.formatOrders(orders || []);
  }

  async getOrderById(orderId: string): Promise<OrderWithItems | null> {
    const { data: order, error } = await supabase
      .from('orders')
      .select(`
        *,
        order_items (*)
      `)
      .eq('id', orderId)
      .single();

    if (error) {
      console.error('Error fetching order:', error);
      throw error;
    }

    if (!order) return null;

    return this.formatOrders([order])[0];
  }

  async updateOrderStatus(orderId: string, status: string): Promise<void> {
    const { error } = await supabase
      .from('orders')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', orderId);

    if (error) {
      console.error('Error updating order status:', error);
      throw error;
    }
  }

  /**
   * Annule une commande via l'Edge Function `cancel-order` : passe le statut à
   * « cancelled » ET envoie un email d'information au client (côté serveur).
   */
  async cancelOrder(orderId: string): Promise<{
    refunded: boolean; refundError: string | null;
    sendcloudCancelled: boolean; sendcloudError: string | null;
  }> {
    const { data, error } = await supabase.functions.invoke('cancel-order', {
      body: { order_id: orderId },
    });
    if (error) {
      const message = (data && (data.error || data.message)) || error.message || "Échec de l'annulation";
      throw new Error(message);
    }
    return {
      refunded: Boolean(data?.refunded), refundError: data?.refundError ?? null,
      sendcloudCancelled: Boolean(data?.sendcloudCancelled), sendcloudError: data?.sendcloudError ?? null,
    };
  }

  /**
   * Génère (ou régénère) l'étiquette d'expédition Sendcloud pour une commande
   * en appelant l'Edge Function `sendcloud-label`.
   *
   * L'Edge Function se charge de créer le colis chez Sendcloud puis d'écrire
   * `sendcloud_parcel_id`, `label_url` et `tracking_number` sur la ligne `orders`.
   * On retourne ces valeurs pour pouvoir rafraîchir l'UI immédiatement.
   */
  async generateLabel(orderId: string): Promise<{
    label_url: string;
    tracking_number: string | null;
    sendcloud_parcel_id: string | null;
  }> {
    const { data, error } = await supabase.functions.invoke('sendcloud-label', {
      body: { order_id: orderId },
    });

    if (error) {
      console.error('Error generating Sendcloud label:', error);
      // L'Edge Function peut renvoyer un message d'erreur structuré dans data
      const message =
        (data && (data.error || data.message)) ||
        error.message ||
        "Échec de la génération de l'étiquette";
      throw new Error(message);
    }

    if (!data?.label_url) {
      throw new Error("L'étiquette n'a pas pu être récupérée (label_url manquant)");
    }

    return {
      label_url: data.label_url,
      tracking_number: data.tracking_number ?? null,
      sendcloud_parcel_id: data.sendcloud_parcel_id ?? data.parcel_id ?? null,
    };
  }

  private formatOrders(orders: any[]): OrderWithItems[] {
    return orders.map(order => {
      // Extraire le nom du client depuis l'adresse de livraison
      const shippingAddress = order.shipping_address || {};
      const customerName = `${shippingAddress.firstName || ''} ${shippingAddress.lastName || ''}`.trim() || 'Client inconnu';

      return {
        ...order,
        customer_name: customerName,
        items_count: order.order_items?.reduce((sum: number, item: DatabaseOrderItem) => sum + item.quantity, 0) || 0,
        source: 'web' as const // Pour l'instant toutes les commandes BDD sont web
      };
    });
  }

  // Statistiques pour le dashboard
  async getOrderStats(): Promise<{
    total_orders: number;
    web_orders: number;
    external_orders: number;
    total_revenue: number;
    web_revenue: number;
    external_revenue: number;
    auction_revenue: number;
    average_order_value: number;
    total_products: number;
    total_customers: number;

  }> {
    const { data: orders, error } = await supabase
      .from('orders')
      .select('total_amount, status')
      .neq('status', 'cancelled')
      .neq('status', 'pending')
      .neq('status', 'refunded');

    if (error) {
      console.error('Error fetching order stats:', error);
      throw error;
    }

    // Ventes « Live enchères » (hors site) : comptabilisées dans le CA au même
    // titre que les commandes. Le prix de vente est saisi à la clôture de la vente.
    const { data: auctionSales, error: auctionError } = await supabase
      .from('products')
      .select('sale_price')
      .eq('status', 'sold-auction');

    if (auctionError) {
      console.error('Error fetching auction sales:', auctionError);
      throw auctionError;
    }

    const auctionRevenue = auctionSales?.reduce((sum, p) => sum + Number(p.sale_price || 0), 0) || 0;

        // ... après avoir récupéré les orders
    const { count: productCount } = await supabase
      .from('products')
      .select('*', { count: 'exact', head: true });

    const { count: customerCount } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true });

    const totalOrders = orders?.length || 0;
    const webOrders = totalOrders; // Toutes les commandes BDD sont web pour l'instant
    const externalOrders = 0; // Pas encore d'intégration externe

    const ordersRevenue = orders?.reduce((sum, order) => sum + Number(order.total_amount), 0) || 0;
    const webRevenue = ordersRevenue;
    const externalRevenue = 0;
    // CA global = commandes (web) + ventes Live enchères (hors site).
    const totalRevenue = ordersRevenue + auctionRevenue;

    const averageOrderValue = totalOrders > 0 ? ordersRevenue / totalOrders : 0;

    return {
      total_orders: totalOrders,
      web_orders: webOrders,
      external_orders: externalOrders,
      total_revenue: totalRevenue,
      web_revenue: webRevenue,
      external_revenue: externalRevenue,
      auction_revenue: auctionRevenue,
      average_order_value: averageOrderValue,
      total_products: productCount || 0,
      total_customers: customerCount || 0
    };
  }

  async getRecentOrders(limit = 5) {
    // 1. Récupérer les commandes
    const { data: orders, error: ordersError } = await supabase
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (ordersError || !orders) return [];

    // 2. Récupérer les profils pour les emails connus
    const emails = orders.map(o => o.email).filter(Boolean);
    const { data: profiles } = await supabase
      .from('profiles')
      .select('email, first_name, last_name')
      .in('email', emails);

    // 3. Fusionner et extraire les noms des adresses si besoin
    return orders.map(order => {
      let profile = profiles?.find(p => p.email?.toLowerCase() === order.email?.toLowerCase());

      // SI LE CLIENT N'A PAS DE COMPTE : On récupère son nom dans l'adresse de livraison
      if (!profile && order.shipping_address) {
        try {
          const shipping = typeof order.shipping_address === 'string' 
            ? JSON.parse(order.shipping_address) 
            : order.shipping_address;
            
          if (shipping?.name) {
            const [first, ...rest] = shipping.name.split(' ');
            profile = {
              first_name: first,
              last_name: rest.join(' '),
              email: order.email
            } as any;
          }
        } catch (e) {
          console.error("Erreur lecture adresse :", e);
        }
      }

      return {
        ...order,
        profiles: profile || null
      };
    });
  }

  async getRecentActivity() {
    // 1. Récupérer les 3 dernières commandes
    const { data: orders } = await supabase
      .from('orders')
      .select('id, created_at, total_amount')
      .order('created_at', { ascending: false })
      .limit(3);

    // 2. Récupérer les 3 derniers profils inscrits
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, created_at, first_name')
      .order('created_at', { ascending: false })
      .limit(3);

    const activities = [];

    // Transformer les commandes en format "Activité"
    if (orders) {
      orders.forEach(o => activities.push({
        id: `order-${o.id}`,
        type: 'order',
        text: `Nouvelle commande de ${o.total_amount}€`,
        date: new Date(o.created_at)
      }));
    }

    // Transformer les profils en format "Activité"
    if (profiles) {
      profiles.forEach(p => activities.push({
        id: `user-${p.id}`,
        type: 'user',
        text: `Nouveau client : ${p.first_name || 'Anonyme'}`,
        date: new Date(p.created_at)
      }));
    }

    // Trier le tout du plus récent au plus ancien
    return activities
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .slice(0, 5); // On garde les 5 derniers événements
  }
}

export const orderService = new OrderService();