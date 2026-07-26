import React from 'react';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { TrendingUp, TrendingDown, Users, Package, ShoppingCart, DollarSign } from 'lucide-react';
import { useState, useEffect } from 'react'; // Ajoute useState et useEffect
import { orderService } from '../../services/orderService'; 

interface DashboardProps {
  activeSubTab: string;
}

// Garantit "DD/MM/YYYY à HH:mm" quel que soit le fuseau/la langue du
// navigateur (toLocaleDateString() sans locale explicite peut varier).
const formatDateTime = (date: Date): string =>
  `${date.toLocaleDateString('fr-FR')} à ${date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;

const INITIAL_LIST_SIZE = 5;
const LOAD_MORE_STEP = 10;

export const Dashboard: React.FC<DashboardProps> = ({ activeSubTab }) => {

  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [recentTransactions, setRecentTransactions] = useState<any[]>([]);
  const [activities, setActivities] = useState<any[]>([]);
  const [transactionsLimit, setTransactionsLimit] = useState(INITIAL_LIST_SIZE);
  const [activitiesLimit, setActivitiesLimit] = useState(INITIAL_LIST_SIZE);
  const [loadingMoreTransactions, setLoadingMoreTransactions] = useState(false);
  const [loadingMoreActivities, setLoadingMoreActivities] = useState(false);
  const [transactionsExhausted, setTransactionsExhausted] = useState(false);
  const [activitiesExhausted, setActivitiesExhausted] = useState(false);

  useEffect(() => {
    orderService.getOrderStats().then(setStats).catch((error) => console.error("Erreur chargement stats:", error));
  }, []);

  // Commandes + rechargements de portefeuille, fusionnés et triés par date.
  // "Voir plus" augmente transactionsLimit de 10 (voir handleLoadMoreTransactions),
  // ce qui redéclenche cet effet et élargit le vivier des deux sources avant
  // de retrier/retronquer.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [ordersData, rechargesData] = await Promise.all([
          orderService.getRecentOrders(transactionsLimit),
          orderService.getRecentWalletRecharges(transactionsLimit),
        ]);
        if (cancelled) return;
        const merged = [
          ...ordersData.map((o: any) => ({ kind: 'order', created_at: o.created_at, data: o })),
          ...rechargesData.map((r: any) => ({ kind: 'recharge', created_at: r.created_at, data: r })),
        ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        setRecentTransactions(merged.slice(0, transactionsLimit));
        // Si les deux sources renvoient moins que demandé, il n'y a plus rien à charger.
        setTransactionsExhausted(ordersData.length < transactionsLimit && rechargesData.length < transactionsLimit);
      } catch (error) {
        console.error("Erreur chargement transactions:", error);
      } finally {
        if (!cancelled) {
          setLoading(false);
          setLoadingMoreTransactions(false);
        }
      }
    };
    load();
    return () => { cancelled = true; };
  }, [transactionsLimit]);

  // Fil d'activité (commandes/clients/recharges) — même logique de pagination.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const activityData = await orderService.getRecentActivity(activitiesLimit);
        if (cancelled) return;
        setActivities(activityData);
        setActivitiesExhausted(activityData.length < activitiesLimit);
      } catch (error) {
        console.error("Erreur chargement activité:", error);
      } finally {
        if (!cancelled) setLoadingMoreActivities(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [activitiesLimit]);

  const handleLoadMoreTransactions = () => {
    setLoadingMoreTransactions(true);
    setTransactionsLimit((n) => n + LOAD_MORE_STEP);
  };

  const handleLoadMoreActivities = () => {
    setLoadingMoreActivities(true);
    setActivitiesLimit((n) => n + LOAD_MORE_STEP);
  };

  if (loading) return <div className="p-6">Chargement des données réelles...</div>;

  if (activeSubTab === 'analytics') {
    return (
      <div className="p-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-6 mb-8">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Taux de Conversion</p>
                  <p className="text-2xl font-bold text-gray-900">3.24%</p>
                  <div className="flex items-center mt-2">
                    <TrendingUp className="h-4 w-4 text-green-500 mr-1" />
                    <span className="text-sm text-green-600">+0.5%</span>
                  </div>
                </div>
                <div className="h-12 w-12 bg-blue-50 rounded-lg flex items-center justify-center">
                  <TrendingUp className="h-6 w-6 text-blue-600" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Sessions</p>
                  <p className="text-2xl font-bold text-gray-900">12,483</p>
                  <div className="flex items-center mt-2">
                    <TrendingUp className="h-4 w-4 text-green-500 mr-1" />
                    <span className="text-sm text-green-600">+12.5%</span>
                  </div>
                </div>
                <div className="h-12 w-12 bg-purple-50 rounded-lg flex items-center justify-center">
                  <Users className="h-6 w-6 text-purple-600" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Taux de Rebond</p>
                  <p className="text-2xl font-bold text-gray-900">42.3%</p>
                  <div className="flex items-center mt-2">
                    <TrendingDown className="h-4 w-4 text-red-500 mr-1" />
                    <span className="text-sm text-red-600">-2.1%</span>
                  </div>
                </div>
                <div className="h-12 w-12 bg-red-50 rounded-lg flex items-center justify-center">
                  <TrendingDown className="h-6 w-6 text-red-600" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Pages Vues</p>
                  <p className="text-2xl font-bold text-gray-900">45,921</p>
                  <div className="flex items-center mt-2">
                    <TrendingUp className="h-4 w-4 text-green-500 mr-1" />
                    <span className="text-sm text-green-600">+8.2%</span>
                  </div>
                </div>
                <div className="h-12 w-12 bg-green-50 rounded-lg flex items-center justify-center">
                  <Package className="h-6 w-6 text-green-600" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <h3 className="text-lg font-semibold text-gray-900">Sources de Trafic</h3>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Google Organique</span>
                  <span className="text-sm font-medium text-gray-900">45.2%</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Direct</span>
                  <span className="text-sm font-medium text-gray-900">23.8%</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Réseaux Sociaux</span>
                  <span className="text-sm font-medium text-gray-900">18.5%</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Email Marketing</span>
                  <span className="text-sm font-medium text-gray-900">12.5%</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <h3 className="text-lg font-semibold text-gray-900">Appareils</h3>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Desktop</span>
                  <span className="text-sm font-medium text-gray-900">52.1%</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Mobile</span>
                  <span className="text-sm font-medium text-gray-900">38.9%</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Tablette</span>
                  <span className="text-sm font-medium text-gray-900">9.0%</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // Default dashboard overview
  return (
    <div className="p-4 md:p-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 md:gap-6 mb-6 md:mb-8">
        <Card>
          <CardContent className="p-4 md:p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Chiffre d'Affaires</p>
                <p className="text-xl md:text-2xl font-bold text-gray-900">{stats?.total_revenue?.toLocaleString()} €</p>
                <div className="flex items-center mt-2">
                  <TrendingUp className="h-4 w-4 text-green-500 mr-1" />
                  <span className="text-sm text-green-600">+12.5%</span>
                </div>
              </div>
              <div className="h-10 w-10 md:h-12 md:w-12 bg-green-50 rounded-lg flex items-center justify-center">
                <DollarSign className="h-6 w-6 text-green-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 md:p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Commandes</p>
                <p className="text-xl md:text-2xl font-bold text-gray-900">{stats?.web_orders || 0}</p>
                <div className="flex items-center mt-2">
                  <TrendingUp className="h-4 w-4 text-green-500 mr-1" />
                  <span className="text-sm text-green-600">+8.2%</span>
                </div>
              </div>
              <div className="h-10 w-10 md:h-12 md:w-12 bg-blue-50 rounded-lg flex items-center justify-center">
                <ShoppingCart className="h-6 w-6 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 md:p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Clients</p>
                <p className="text-xl md:text-2xl font-bold text-gray-900">{stats?.total_customers || 0}</p>
                <div className="flex items-center mt-2">
                  <TrendingUp className="h-4 w-4 text-green-500 mr-1" />
                  <span className="text-sm text-green-600">+5.7%</span>
                </div>
              </div>
              <div className="h-10 w-10 md:h-12 md:w-12 bg-purple-50 rounded-lg flex items-center justify-center">
                <Users className="h-6 w-6 text-purple-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 md:p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Produits</p>
                <p className="text-xl md:text-2xl font-bold text-gray-900">{stats?.total_products || 0}</p>
                <div className="flex items-center mt-2">
                  <TrendingDown className="h-4 w-4 text-red-500 mr-1" />
                  <span className="text-sm text-red-600">-2.1%</span>
                </div>
              </div>
              <div className="h-10 w-10 md:h-12 md:w-12 bg-orange-50 rounded-lg flex items-center justify-center">
                <Package className="h-6 w-6 text-orange-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
        <div className="lg:col-span-2">
          <Card>
            <CardContent>
              <div className="space-y-4">
                {recentTransactions.map((tx) => {
                  if (tx.kind === 'recharge') {
                    const r = tx.data;
                    return (
                      <div key={`recharge-${r.id}`} className="flex items-center justify-between p-2 hover:bg-gray-50 rounded-lg transition-colors">
                        <div className="flex items-center space-x-3">
                          <div className="h-8 w-8 bg-violet-100 rounded-full flex items-center justify-center text-violet-600 font-bold text-xs">
                            💳
                          </div>
                          <div>
                            <p className="text-sm font-medium text-gray-900">{r.displayName}</p>
                            <p className="text-xs text-gray-500">{formatDateTime(new Date(r.created_at))}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-bold text-gray-900">+{r.amount.toFixed(2)} €</p>
                          <p className="text-[10px] uppercase font-semibold text-violet-600">Recharge</p>
                        </div>
                      </div>
                    );
                  }

                  const order = tx.data;
                  const isCancelled = order.status === 'cancelled';
                  // order.total_amount est recalculé sur les articles ACTIFS restants
                  // (voir cancel_b2b_order_item/cancel_b2b_order) — retombe à ~0 après
                  // une annulation complète, donc ne reflète jamais ce qui a été rendu.
                  const cancelledItems = isCancelled ? (order.order_items || []).filter((i: any) => i.status === 'cancelled') : [];
                  const refundedAmount = cancelledItems.reduce(
                    (sum: number, i: any) => sum + Number(i.line_total) + (i.insured ? Number(i.insurance_cost) : 0),
                    0
                  );
                  const refundMethod = cancelledItems.find((i: any) => i.refund_method)?.refund_method;
                  const refundMethodLabel = refundMethod === 'wallet' ? 'Solde B2B' : refundMethod === 'stripe' ? 'Stripe' : null;

                  return (
                    <div key={order.id} className="flex items-center justify-between p-2 hover:bg-gray-50 rounded-lg transition-colors">
                      <div className="flex items-center space-x-3">
                        <div className="h-8 w-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-bold text-xs">
                          {order.profiles?.first_name?.charAt(0) || 'C'}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-900">{order.profiles?.first_name} {order.profiles?.last_name || ''}</p>
                          <p className="text-xs text-gray-500">{formatDateTime(new Date(order.created_at))}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className={`text-sm font-bold ${isCancelled ? 'text-red-600' : 'text-gray-900'}`}>
                          {isCancelled ? `-${refundedAmount.toFixed(2)} €` : `${order.total_amount} €`}
                        </p>
                        <p className={`text-[10px] uppercase font-semibold ${isCancelled ? 'text-red-600' : ['confirmed', 'shipped', 'delivered'].includes(order.status) ? 'text-green-600' : order.status === 'pending' ? 'text-orange-600' : 'text-red-600'}`}>
                          {isCancelled ? 'Annulée' : order.status === 'pending' ? 'En attente' : order.status === 'confirmed' ? 'Confirmée' : order.status === 'shipped' ? 'Expédiée' : order.status === 'delivered' ? 'Livrée' : order.status}
                        </p>
                        {isCancelled && refundMethodLabel && (
                          <p className="text-[10px] text-gray-400 mt-0.5">Remboursé en {refundMethodLabel}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
                {recentTransactions.length === 0 && <p className="text-sm text-gray-500 text-center">Aucune vente récente</p>}
              </div>
              {!transactionsExhausted && recentTransactions.length > 0 && (
                <button
                  onClick={handleLoadMoreTransactions}
                  disabled={loadingMoreTransactions}
                  className="w-full mt-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-colors disabled:opacity-50"
                >
                  {loadingMoreTransactions ? 'Chargement...' : 'Voir plus'}
                </button>
              )}
            </CardContent>
          </Card>
        </div>

        <div>
          <Card>
            <CardHeader>
              <h3 className="text-lg font-semibold text-gray-900">Activité Récente</h3>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {activities.map((activity) => (
                  <div key={activity.id} className="flex items-start space-x-3">
                    <div className={`mt-1 h-2 w-2 rounded-full ${activity.type === 'order' ? 'bg-green-500' : activity.type === 'wallet' ? 'bg-violet-500' : activity.type === 'cancellation' ? 'bg-red-500' : 'bg-blue-500'}`} />
                    <div>
                      <p className="text-sm font-medium text-gray-900">{activity.text}</p>
                      <p className="text-xs text-gray-500">{formatDateTime(activity.date)}</p>
                    </div>
                  </div>
                ))}
                {activities.length === 0 && (
                  <p className="text-sm text-gray-500 text-center">Aucune activité récente</p>
                )}
              </div>
              {!activitiesExhausted && activities.length > 0 && (
                <button
                  onClick={handleLoadMoreActivities}
                  disabled={loadingMoreActivities}
                  className="w-full mt-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-colors disabled:opacity-50"
                >
                  {loadingMoreActivities ? 'Chargement...' : 'Voir plus'}
                </button>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};