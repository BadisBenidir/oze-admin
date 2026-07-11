import React from 'react';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { TrendingUp, TrendingDown, Users, Package, ShoppingCart, DollarSign } from 'lucide-react';
import { useState, useEffect } from 'react'; // Ajoute useState et useEffect
import { orderService } from '../../services/orderService'; 

interface DashboardProps {
  activeSubTab: string;
}

export const Dashboard: React.FC<DashboardProps> = ({ activeSubTab }) => {

  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [recentOrders, setRecentOrders] = useState<any[]>([]);
  const [activities, setActivities] = useState<any[]>([]);

  useEffect(() => {
    const loadAll = async () => {
      try {
        const [statsData, ordersData, activityData] = await Promise.all([
          orderService.getOrderStats(),
          orderService.getRecentOrders(5),
          orderService.getRecentActivity(),
        ]);
        setStats(statsData);
        setRecentOrders(ordersData);
        setActivities(activityData);
      } catch (error) {
        console.error("Erreur chargement dashboard:", error);
      } finally {
        setLoading(false);
      }
    };
    loadAll();
  }, []);

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
                {recentOrders.map((order) => (
                  <div key={order.id} className="flex items-center justify-between p-2 hover:bg-gray-50 rounded-lg transition-colors">
                    <div className="flex items-center space-x-3">
                      <div className="h-8 w-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-bold text-xs">
                        {order.profiles?.first_name?.charAt(0) || 'C'}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900">{order.profiles?.first_name} {order.profiles?.last_name || ''}</p>
                        <p className="text-xs text-gray-500">{new Date(order.created_at).toLocaleDateString()}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-gray-900">{order.total_amount} €</p>
                      <p className={`text-[10px] uppercase font-semibold ${['confirmed', 'shipped', 'delivered'].includes(order.status) ? 'text-green-600' : order.status === 'pending' ? 'text-orange-600' : 'text-red-600'}`}>
                        {order.status === 'pending' ? 'En attente' : order.status === 'confirmed' ? 'Confirmée' : order.status === 'shipped' ? 'Expédiée' : order.status === 'delivered' ? 'Livrée' : order.status}
                      </p>
                    </div>
                  </div>
                ))}
                {recentOrders.length === 0 && <p className="text-sm text-gray-500 text-center">Aucune vente récente</p>}
              </div>
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
                    <div className={`mt-1 h-2 w-2 rounded-full ${activity.type === 'order' ? 'bg-green-500' : 'bg-blue-500'}`} />
                    <div>
                      <p className="text-sm font-medium text-gray-900">{activity.text}</p>
                      <p className="text-xs text-gray-500">
                        {activity.date.toLocaleDateString()} à {activity.date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                      </p>
                    </div>
                  </div>
                ))}
                {activities.length === 0 && (
                  <p className="text-sm text-gray-500 text-center">Aucune activité récente</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};