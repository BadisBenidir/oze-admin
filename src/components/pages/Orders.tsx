import React, { useState } from 'react';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { useOrders, useOrderStats } from '../../hooks/useOrders';
import { OrderDetail } from './OrderDetail';
import { OrderTrackingCell } from '../orders/OrderTrackingCell';
import {
  ShipmentStatusFilter,
  getShipmentStatus,
  type ShipmentStatus,
} from '../orders/ShipmentStatusFilter';
import { Eye, Download, Truck, Globe, Archive, Plus, Loader2 } from 'lucide-react';

interface OrdersProps {
  activeSubTab: string;
}

export const Orders: React.FC<OrdersProps> = ({ activeSubTab }) => {
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [shipmentFilter, setShipmentFilter] = useState<ShipmentStatus>('all');
  const source = activeSubTab === 'web-orders' ? 'web' : activeSubTab === 'external-orders' ? 'external' : undefined;
  const { orders, loading, error, updateOrderStatus } = useOrders(source);
  const { stats, loading: statsLoading } = useOrderStats();

  // Compteurs par statut d'expédition (sur l'ensemble des commandes chargées)
  const shipmentCounts = orders.reduce(
    (acc, order) => {
      acc.all += 1;
      acc[getShipmentStatus(order)] += 1;
      return acc;
    },
    { all: 0, to_ship: 0, label_created: 0, shipped: 0, delivered: 0 } as Record<ShipmentStatus, number>
  );

  // Liste filtrée pour la vue globale
  const filteredOrders =
    shipmentFilter === 'all'
      ? orders
      : orders.filter((order) => getShipmentStatus(order) === shipmentFilter);

  // Si un ordre est sélectionné, afficher la page de détail
  if (selectedOrderId) {
    return (
      <OrderDetail 
        orderId={selectedOrderId} 
        onBack={() => setSelectedOrderId(null)} 
      />
    );
  }

  const getStatusVariant = (status: string) => {
    switch (status) {
      case 'pending':
        return 'default';
      case 'confirmed':
      case 'paid':
      case 'processing':
        return 'info';
      case 'shipped':
        return 'warning';
      case 'delivered':
        return 'success';
      case 'cancelled':
      case 'canceled':
      case 'refunded':
        return 'danger';
      default:
        return 'default';
    }
  };

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      pending: 'En attente',
      confirmed: 'Confirmée',
      paid: 'Payée',
      processing: 'Confirmée',
      shipped: 'Expédiée',
      delivered: 'Livrée',
      cancelled: 'Annulée',
      canceled: 'Annulée',
      refunded: 'Remboursée',
    };
    return labels[status] ?? status;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-gray-500" />
        <span className="ml-2 text-gray-500">Chargement des commandes...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800">Erreur: {error}</p>
        </div>
      </div>
    );
  }

  if (activeSubTab === 'web-orders') {
    return (
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Commandes Site Web</h3>
            <p className="text-sm text-gray-500">
              Commandes passées directement sur votre site e-commerce
            </p>
          </div>
          
          <div className="flex items-center space-x-3">
            <button className="flex items-center space-x-2 px-4 py-2 border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors">
              <Download className="h-4 w-4" />
              <span>Exporter</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Commandes Web</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {statsLoading ? '-' : stats.web_orders}
                  </p>
                  <div className="flex items-center mt-2">
                    <Globe className="h-4 w-4 text-blue-500 mr-1" />
                    <span className="text-sm text-blue-600">Site web</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Chiffre d'Affaires</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {statsLoading ? '-' : `€${stats.web_revenue.toFixed(2)}`}
                  </p>
                  <div className="flex items-center mt-2">
                    <span className="text-sm text-green-600">Revenus web</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Panier Moyen</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {statsLoading ? '-' : `€${stats.average_order_value.toFixed(2)}`}
                  </p>
                  <div className="flex items-center mt-2">
                    <span className="text-sm text-gray-600">Moyenne web</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-4 px-6 font-medium text-gray-900">Commande</th>
                    <th className="text-left py-4 px-6 font-medium text-gray-900">Client</th>
                    <th className="text-left py-4 px-6 font-medium text-gray-900">Date</th>
                    <th className="text-left py-4 px-6 font-medium text-gray-900">Articles</th>
                    <th className="text-left py-4 px-6 font-medium text-gray-900">Total</th>
                    <th className="text-left py-4 px-6 font-medium text-gray-900">Source</th>
                    <th className="text-left py-4 px-6 font-medium text-gray-900">Statut</th>
                    <th className="text-left py-4 px-6 font-medium text-gray-900">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => (
                    <tr key={order.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                      <td className="py-4 px-6">
                        <span className="font-mono text-sm font-medium text-gray-900">{order.order_number}</span>
                      </td>
                      <td className="py-4 px-6">
                        <div>
                          <p className="font-medium text-gray-900">{order.customer_name}</p>
                          <p className="text-sm text-gray-500">{order.email}</p>
                        </div>
                      </td>
                      <td className="py-4 px-6">
                        <span className="text-sm text-gray-600">
                          {new Date(order.created_at).toLocaleDateString('fr-FR')}
                        </span>
                      </td>
                      <td className="py-4 px-6">
                        <span className="text-sm text-gray-900">{order.items_count} article{order.items_count > 1 ? 's' : ''}</span>
                      </td>
                      <td className="py-4 px-6">
                        <span className="font-medium text-gray-900">€{order.total_amount.toFixed(2)}</span>
                      </td>
                      <td className="py-4 px-6">
                        <Badge variant="info">
                          <Globe className="h-3 w-3 mr-1" />
                          Site web
                        </Badge>
                      </td>
                      <td className="py-4 px-6">
                        <Badge variant={getStatusVariant(order.status)}>
                          {getStatusLabel(order.status)}
                        </Badge>
                      </td>
                      <td className="py-4 px-6">
                        <div className="flex items-center space-x-2">
                          <button 
                            className="p-1 text-gray-400 hover:text-blue-600 transition-colors"
                            onClick={() => setSelectedOrderId(order.id)}
                            title="Voir les détails"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          {order.status === 'confirmed' && (
                            <button 
                              className="p-1 text-gray-400 hover:text-green-600 transition-colors"
                              onClick={() => updateOrderStatus(order.id, 'shipped')}
                              title="Marquer comme expédiée"
                            >
                              <Truck className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (activeSubTab === 'external-orders') {
    return (
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Commandes Plateformes Externes</h3>
            <p className="text-sm text-gray-500">
              Commandes provenant de Vinted, eBay, Amazon et autres plateformes
            </p>
          </div>
          
          <div className="flex items-center space-x-3">
            <button className="flex items-center space-x-2 px-4 py-2 border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors">
              <Download className="h-4 w-4" />
              <span>Exporter</span>
            </button>
            <button className="flex items-center space-x-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors">
              <Plus className="h-4 w-4" />
              <span>Ajouter Commande</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-8">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Commandes Externes</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {statsLoading ? '-' : stats.external_orders}
                  </p>
                  <div className="flex items-center mt-2">
                    <Archive className="h-4 w-4 text-purple-500 mr-1" />
                    <span className="text-sm text-purple-600">Plateformes</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Vinted</p>
                  <p className="text-2xl font-bold text-gray-900">0</p>
                  <div className="flex items-center mt-2">
                    <span className="text-sm text-green-600">€0.00</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">eBay</p>
                  <p className="text-2xl font-bold text-gray-900">0</p>
                  <div className="flex items-center mt-2">
                    <span className="text-sm text-gray-600">€0.00</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Amazon</p>
                  <p className="text-2xl font-bold text-gray-900">0</p>
                  <div className="flex items-center mt-2">
                    <span className="text-sm text-gray-600">€0.00</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-4 px-6 font-medium text-gray-900">Commande</th>
                    <th className="text-left py-4 px-6 font-medium text-gray-900">Client</th>
                    <th className="text-left py-4 px-6 font-medium text-gray-900">Date</th>
                    <th className="text-left py-4 px-6 font-medium text-gray-900">Articles</th>
                    <th className="text-left py-4 px-6 font-medium text-gray-900">Total</th>
                    <th className="text-left py-4 px-6 font-medium text-gray-900">Plateforme</th>
                    <th className="text-left py-4 px-6 font-medium text-gray-900">Statut</th>
                    <th className="text-left py-4 px-6 font-medium text-gray-900">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center">
                        <div className="text-gray-500">
                          <Archive className="h-12 w-12 mx-auto mb-2 text-gray-300" />
                          <p>Aucune commande externe pour le moment</p>
                          <p className="text-sm">Les commandes Vinted, eBay et autres plateformes apparaîtront ici</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    orders.map((order) => (
                      <tr key={order.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                        <td className="py-4 px-6">
                          <span className="font-mono text-sm font-medium text-gray-900">{order.order_number}</span>
                        </td>
                        <td className="py-4 px-6">
                          <div>
                            <p className="font-medium text-gray-900">{order.customer_name}</p>
                            <p className="text-sm text-gray-500">{order.email}</p>
                          </div>
                        </td>
                        <td className="py-4 px-6">
                          <span className="text-sm text-gray-600">
                            {new Date(order.created_at).toLocaleDateString('fr-FR')}
                          </span>
                        </td>
                        <td className="py-4 px-6">
                          <span className="text-sm text-gray-900">{order.items_count} article{order.items_count > 1 ? 's' : ''}</span>
                        </td>
                        <td className="py-4 px-6">
                          <span className="font-medium text-gray-900">€{order.total_amount.toFixed(2)}</span>
                        </td>
                        <td className="py-4 px-6">
                          <Badge variant="warning">
                            <Archive className="h-3 w-3 mr-1" />
                            {order.platform || 'Externe'}
                          </Badge>
                        </td>
                        <td className="py-4 px-6">
                          <Badge variant={getStatusVariant(order.status)}>
                            {getStatusLabel(order.status)}
                          </Badge>
                        </td>
                        <td className="py-4 px-6">
                          <div className="flex items-center space-x-2">
                            <button 
                              className="p-1 text-gray-400 hover:text-blue-600 transition-colors"
                              onClick={() => setSelectedOrderId(order.id)}
                              title="Voir les détails"
                            >
                              <Eye className="h-4 w-4" />
                            </button>
                            {order.status === 'confirmed' && (
                              <button 
                                className="p-1 text-gray-400 hover:text-green-600 transition-colors"
                                onClick={() => updateOrderStatus(order.id, 'shipped')}
                                title="Marquer comme expédiée"
                              >
                                <Truck className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">
            Toutes les Commandes
          </h3>
          <p className="text-sm text-gray-500">
            {filteredOrders.length} commande{filteredOrders.length > 1 ? 's' : ''} affichée{filteredOrders.length > 1 ? 's' : ''}
            {shipmentFilter !== 'all' && ` sur ${orders.length}`}
          </p>
        </div>

        <div className="flex items-center space-x-3 hidden md:flex">
          <button className="flex items-center space-x-2 px-4 py-2 border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors">
            <Download className="h-4 w-4" />
            <span>Exporter</span>
          </button>
        </div>
      </div>

      {/* Filtre par statut d'expédition */}
      <div className="mb-6">
        <ShipmentStatusFilter
          value={shipmentFilter}
          onChange={setShipmentFilter}
          counts={shipmentCounts}
        />
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto -mx-4 md:mx-0">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-3 md:py-4 px-4 md:px-6 font-medium text-gray-900 text-xs md:text-sm">Commande</th>
                  <th className="text-left py-3 md:py-4 px-4 md:px-6 font-medium text-gray-900 text-xs md:text-sm hidden sm:table-cell">Client</th>
                  <th className="text-left py-3 md:py-4 px-4 md:px-6 font-medium text-gray-900 text-xs md:text-sm hidden md:table-cell">Date</th>
                  <th className="text-left py-3 md:py-4 px-4 md:px-6 font-medium text-gray-900 text-xs md:text-sm hidden lg:table-cell">Articles</th>
                  <th className="text-left py-3 md:py-4 px-4 md:px-6 font-medium text-gray-900 text-xs md:text-sm">Total</th>
                  <th className="text-left py-3 md:py-4 px-4 md:px-6 font-medium text-gray-900 text-xs md:text-sm hidden md:table-cell">Source</th>
                  <th className="text-left py-3 md:py-4 px-4 md:px-6 font-medium text-gray-900 text-xs md:text-sm">Statut</th>
                  <th className="text-left py-3 md:py-4 px-4 md:px-6 font-medium text-gray-900 text-xs md:text-sm hidden lg:table-cell">Suivi</th>
                  <th className="text-left py-3 md:py-4 px-4 md:px-6 font-medium text-gray-900 text-xs md:text-sm">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-8 text-center">
                      <div className="text-gray-500">
                        <Globe className="h-12 w-12 mx-auto mb-2 text-gray-300" />
                        <p>
                          {orders.length === 0
                            ? 'Aucune commande pour le moment'
                            : 'Aucune commande pour ce filtre'}
                        </p>
                        <p className="text-sm">
                          {orders.length === 0
                            ? 'Les commandes apparaîtront ici dès qu\'elles seront passées'
                            : 'Essayez un autre statut d\'expédition'}
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredOrders.map((order) => (
                    <tr key={order.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                      <td className="py-3 md:py-4 px-4 md:px-6">
                        <span className="font-mono text-xs md:text-sm font-medium text-gray-900">{order.order_number}</span>
                      </td>
                      <td className="py-3 md:py-4 px-4 md:px-6 hidden sm:table-cell">
                        <div>
                          <p className="font-medium text-gray-900 text-sm md:text-base">{order.customer_name}</p>
                          <p className="text-xs md:text-sm text-gray-500">{order.email}</p>
                        </div>
                      </td>
                      <td className="py-3 md:py-4 px-4 md:px-6 hidden md:table-cell">
                        <span className="text-xs md:text-sm text-gray-600">
                          {new Date(order.created_at).toLocaleDateString('fr-FR')}
                        </span>
                      </td>
                      <td className="py-3 md:py-4 px-4 md:px-6 hidden lg:table-cell">
                        <span className="text-xs md:text-sm text-gray-900">{order.items_count} article{order.items_count > 1 ? 's' : ''}</span>
                      </td>
                      <td className="py-3 md:py-4 px-4 md:px-6">
                        <span className="font-medium text-gray-900 text-sm md:text-base">€{order.total_amount.toFixed(2)}</span>
                      </td>
                      <td className="py-3 md:py-4 px-4 md:px-6 hidden md:table-cell">
                        {order.source === 'web' ? (
                          <Badge variant="info">
                            <Globe className="h-3 w-3 mr-1" />
                            Site web
                          </Badge>
                        ) : (
                          <Badge variant="warning">
                            <Archive className="h-3 w-3 mr-1" />
                            {order.platform || 'Externe'}
                          </Badge>
                        )}
                      </td>
                      <td className="py-3 md:py-4 px-4 md:px-6">
                        <Badge variant={getStatusVariant(order.status)}>
                          {getStatusLabel(order.status)}
                        </Badge>
                      </td>
                      <td className="py-3 md:py-4 px-4 md:px-6 hidden lg:table-cell">
                        <OrderTrackingCell
                          trackingNumber={order.tracking_number}
                          trackingUrl={order.tracking_url}
                          shippingAddress={order.shipping_address}
                        />
                      </td>
                      <td className="py-3 md:py-4 px-4 md:px-6">
                        <div className="flex items-center space-x-1 md:space-x-2">
                          <button
                            className="p-1 text-gray-400 hover:text-blue-600 transition-colors"
                            onClick={() => setSelectedOrderId(order.id)}
                            title="Voir les détails"
                          >
                            <Eye className="h-3 w-3 md:h-4 md:w-4" />
                          </button>
                          {order.status === 'confirmed' && (
                            <button 
                              className="p-1 text-gray-400 hover:text-green-600 transition-colors"
                              onClick={() => updateOrderStatus(order.id, 'shipped')}
                              title="Marquer comme expédiée"
                            >
                              <Truck className="h-3 w-3 md:h-4 md:w-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};