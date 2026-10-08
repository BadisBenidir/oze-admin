import { useState, useEffect, useRef } from 'react';
import { orderService, type OrderWithItems } from '../services/orderService';

export const useOrders = (source?: 'web' | 'external') => {
  const [orders, setOrders] = useState<OrderWithItems[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // « Toutes les commandes » et « Commandes site web » partagent le même
  // composant : en passant de l'un à l'autre, la liste complète (plus lente)
  // pouvait arriver APRÈS la liste filtrée et l'écraser (commandes B2B
  // affichées dans « Commandes site web »). Seule la dernière requête compte.
  const requestIdRef = useRef(0);

  const fetchOrders = async () => {
    const requestId = ++requestIdRef.current;
    try {
      setLoading(true);
      setError(null);

      let fetchedOrders: OrderWithItems[];

      if (source) {
        fetchedOrders = await orderService.getOrdersBySource(source);
      } else {
        fetchedOrders = await orderService.getAllOrders();
      }

      if (requestId !== requestIdRef.current) return;
      setOrders(fetchedOrders);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      console.error('Error fetching orders:', err);
      setError(err instanceof Error ? err.message : 'Erreur lors du chargement des commandes');
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, [source]);

  const updateOrderStatus = async (orderId: string, status: string) => {
    try {
      await orderService.updateOrderStatus(orderId, status);
      // Recharger les commandes après mise à jour
      await fetchOrders();
    } catch (err) {
      console.error('Error updating order status:', err);
      setError(err instanceof Error ? err.message : 'Erreur lors de la mise à jour');
    }
  };

  const refetch = () => {
    fetchOrders();
  };

  return {
    orders,
    loading,
    error,
    updateOrderStatus,
    refetch
  };
};

export const useOrderStats = () => {
  const [stats, setStats] = useState({
    total_orders: 0,
    web_orders: 0,
    external_orders: 0,
    total_revenue: 0,
    web_revenue: 0,
    external_revenue: 0,
    average_order_value: 0
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        setLoading(true);
        setError(null);
        const orderStats = await orderService.getOrderStats();
        setStats(orderStats);
      } catch (err) {
        console.error('Error fetching order stats:', err);
        setError(err instanceof Error ? err.message : 'Erreur lors du chargement des statistiques');
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, []);

  return { stats, loading, error };
};