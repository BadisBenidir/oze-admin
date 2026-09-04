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
  // Assurance colis optionnelle (0.6% de la valeur, revendeurs B2B)
  insurance_cost?: number;
  insured_value?: number;
  // Commande groupée : cette commande part dans le même colis Sendcloud
  // qu'une commande précédente (voir CartPage.tsx "Grouper avec ma commande
  // en cours") — pas d'étiquette séparée à générer pour elle.
  grouped_with_order_id?: string | null;
  order_channel?: string;
  // Remise dégressive B2B sur volume d'articles (paliers stricts, sur la
  // valeur des articles uniquement — jamais livraison ni assurance).
  discount_rate?: number;
  discount_amount?: number;
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
    // Commandes externes (Vinted, eBay...) : jamais alimentées, voir
    // Orders.tsx (section retirée) — aucune donnée à retourner ici.
    if (source === 'external') {
      return [];
    }

    // 'web' = strictement B2C site web : orders.order_channel distingue
    // 'web' de 'b2b' (voir 0001/0011_b2b_schema.sql) — cette table est
    // partagée entre les deux canaux, donc sans ce filtre "Commandes site
    // web" affichait aussi les commandes B2B revendeurs. Les ventes Live
    // n'ont jamais de ligne `orders` (voir products.status='sold-auction'),
    // donc rien à exclure de plus ici pour elles.
    const { data: orders, error } = await supabase
      .from('orders')
      .select(`
        *,
        order_items (*)
      `)
      .eq('order_channel', 'web')
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
    // 1. Récupérer les commandes — order_items minimal pour calculer le
    // montant réellement remboursé d'une commande annulée (order.total_amount
    // est recalculé par cancel_b2b_order_item/cancel_b2b_order sur les
    // articles restants ACTIFS, donc retombe à ~0 après annulation complète
    // — il ne reflète jamais ce qui a été rendu au client).
    const { data: orders, error: ordersError } = await supabase
      .from('orders')
      .select('*, order_items(line_total, insured, insurance_cost, status, refund_method)')
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

  // Rechargements de portefeuille B2B (wallet_transactions.type =
  // 'rechargement'), avec le nom du contact et/ou de l'entreprise revendeuse
  // qui a rechargé. Deux FK distinctes de wallet_transactions vers profiles
  // (profile_id ET created_by) obligent à lever l'ambiguïté avec le nom de
  // la contrainte plutôt qu'un simple `profiles(...)`.
  async getRecentWalletRecharges(limit = 5) {
    const { data, error } = await supabase
      .from('wallet_transactions')
      .select('id, amount, created_at, profiles!wallet_transactions_profile_id_fkey(first_name, last_name), resellers(company_name)')
      .eq('type', 'rechargement')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error || !data) return [];

    return data.map((r: any) => {
      const contactName = r.profiles ? `${r.profiles.first_name || ''} ${r.profiles.last_name || ''}`.trim() : '';
      const companyName = r.resellers?.company_name || '';
      return {
        id: r.id,
        amount: Number(r.amount),
        created_at: r.created_at,
        contactName,
        companyName,
        displayName: contactName || companyName || 'Revendeur',
      };
    });
  }

  // Annulations B2B (order_items.status = 'cancelled') — regroupées par
  // (order_id, cancelled_at EXACT) : cancel_b2b_order (annulation de toute
  // la commande) cancelle tous ses articles dans UNE seule transaction, donc
  // ils partagent le même now() Postgres (constant par transaction) — alors
  // que cancel_b2b_order_item et la boucle d'annulation partielle du
  // revendeur (item par item, un appel RPC distinct par article) produisent
  // chacun un cancelled_at différent. Un groupe de plus d'un article = une
  // vraie annulation de commande entière ; un groupe d'un seul = un article
  // annulé individuellement (même si c'était le dernier de la commande).
  async getRecentCancellations(limit = 3) {
    const { data, error } = await supabase
      .from('order_items')
      .select(
        'id, order_id, line_total, insured, insurance_cost, cancelled_at, refund_method, product_snapshot, orders!inner(order_number, reseller:resellers(company_name), placed_by:profiles!orders_placed_by_profile_id_fkey(first_name, last_name))'
      )
      .eq('status', 'cancelled')
      .not('cancelled_at', 'is', null)
      .order('cancelled_at', { ascending: false })
      .limit(limit * 3);

    if (error || !data) return [];

    const groups = new Map<string, any[]>();
    for (const row of data as any[]) {
      const key = `${row.order_id}_${row.cancelled_at}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row);
    }

    const events = [...groups.values()].map((items) => {
      const first = items[0];
      const order = Array.isArray(first.orders) ? first.orders[0] : first.orders;
      const reseller = Array.isArray(order?.reseller) ? order.reseller[0] : order?.reseller;
      const placedBy = Array.isArray(order?.placed_by) ? order.placed_by[0] : order?.placed_by;
      const contactName = placedBy ? `${placedBy.first_name || ''} ${placedBy.last_name || ''}`.trim() : '';
      const who = contactName || reseller?.company_name || 'Revendeur';
      const amount = items.reduce(
        (sum: number, i: any) => sum + Number(i.line_total) + (i.insured ? Number(i.insurance_cost) : 0),
        0
      );

      return {
        id: `cancel-${first.order_id}-${first.cancelled_at}`,
        isWholeOrder: items.length > 1,
        productName: first.product_snapshot?.name || 'Produit',
        amount,
        who,
        created_at: first.cancelled_at as string,
      };
    });

    return events
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, limit);
  }

  // `limit` porte sur CHAQUE source (commandes/clients/recharges), pas sur le
  // total renvoyé : "Voir plus" l'augmente de 10 à chaque clic pour élargir
  // le vivier avant de retrier et de retronquer au même nombre.
  async getRecentActivity(limit = 3) {
    // 1. Récupérer les dernières commandes
    const { data: orders } = await supabase
      .from('orders')
      .select('id, created_at, total_amount')
      .order('created_at', { ascending: false })
      .limit(limit);

    // 2. Récupérer les derniers profils inscrits
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, created_at, first_name')
      .order('created_at', { ascending: false })
      .limit(limit);

    // 3. Récupérer les derniers rechargements de portefeuille B2B
    const recharges = await this.getRecentWalletRecharges(limit);

    // 4. Récupérer les dernières annulations (commande entière ou article)
    const cancellations = await this.getRecentCancellations(limit);

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

    // Transformer les rechargements en format "Activité"
    recharges.forEach(r => activities.push({
      id: `wallet-${r.id}`,
      type: 'wallet',
      text: `💳 Recharge portefeuille de ${r.amount.toFixed(2)} € par ${r.displayName}`,
      date: new Date(r.created_at)
    }));

    // Transformer les annulations en format "Activité"
    cancellations.forEach(c => activities.push({
      id: c.id,
      type: 'cancellation',
      text: c.isWholeOrder
        ? `🔴 Commande de ${c.amount.toFixed(2)} € annulée par ${c.who}`
        : `🔴 Article ${c.productName} (${c.amount.toFixed(2)} €) annulé par ${c.who}`,
      date: new Date(c.created_at)
    }));

    // Trier le tout du plus récent au plus ancien
    return activities
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .slice(0, limit);
  }
}

export const orderService = new OrderService();