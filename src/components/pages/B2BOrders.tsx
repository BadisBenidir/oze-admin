import React, { useEffect, useState } from 'react';
import { Card, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { useAdminAuth } from '../../hooks/useAdminAuth';
import { useB2BOrders, B2BOrder } from '../../hooks/useB2BOrders';
import { useAdminDeliveryBatches, AdminDeliveryBatch } from '../../hooks/useAdminDeliveryBatches';
import { B2BOrderDetailModal } from './b2b/B2BOrderDetailModal';
import { AlertCircle, RefreshCw, ShoppingBag, Eye, Truck } from 'lucide-react';

const statusBadge = (status: string) => {
  switch (status) {
    case 'shipped':
      return <Badge variant="info">Expédiée</Badge>;
    case 'delivered':
      return <Badge variant="success">Livrée</Badge>;
    case 'cancelled':
      return <Badge variant="danger">Annulée</Badge>;
    default:
      return <Badge variant="success">Confirmée</Badge>;
  }
};

const batchStatusBadge = (status: AdminDeliveryBatch['status']) => {
  switch (status) {
    case 'delivery_available':
      return <Badge variant="success">Livraison disponible</Badge>;
    case 'requested':
      return <Badge variant="info">Livraison demandée</Badge>;
    case 'shipped':
      return <Badge variant="success">Expédié</Badge>;
    default:
      return <Badge variant="warning">En préparation</Badge>;
  }
};

interface OrdersTableProps {
  orders: B2BOrder[];
  loading: boolean;
  showReseller: boolean;
  onView: (order: B2BOrder) => void;
}

const OrdersTable: React.FC<OrdersTableProps> = ({ orders, loading, showReseller, onView }) => (
  <Card>
    <CardContent className="p-0">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left py-3 px-4 md:px-6 font-medium text-gray-900 text-sm">Commande</th>
              {showReseller && <th className="text-left py-3 px-4 md:px-6 font-medium text-gray-900 text-sm">Revendeur</th>}
              <th className="text-left py-3 px-4 md:px-6 font-medium text-gray-900 text-sm hidden md:table-cell">Articles</th>
              <th className="text-left py-3 px-4 md:px-6 font-medium text-gray-900 text-sm">Total</th>
              <th className="text-left py-3 px-4 md:px-6 font-medium text-gray-900 text-sm">Statut</th>
              <th className="text-left py-3 px-4 md:px-6 font-medium text-gray-900 text-sm">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [...Array(3)].map((_, i) => (
                <tr key={`skeleton-${i}`} className="border-b border-gray-50">
                  <td className="py-4 px-4 md:px-6" colSpan={showReseller ? 6 : 5}>
                    <div className="h-4 w-full bg-gray-100 rounded animate-pulse" />
                  </td>
                </tr>
              ))
            ) : (
              orders.map((order) => (
                <tr key={order.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                  <td className="py-4 px-4 md:px-6">
                    <p className="font-medium text-gray-900 text-sm">{order.order_number}</p>
                    <p className="text-xs text-gray-500">{new Date(order.created_at).toLocaleDateString('fr-FR')}</p>
                  </td>
                  {showReseller && <td className="py-4 px-4 md:px-6 text-sm text-gray-700">{order.reseller?.company_name || '—'}</td>}
                  <td className="py-4 px-4 md:px-6 hidden md:table-cell text-sm text-gray-600">{order.order_items.length} pièce{order.order_items.length > 1 ? 's' : ''}</td>
                  <td className="py-4 px-4 md:px-6 text-sm font-semibold text-gray-900">{order.total_amount.toFixed(0)} €</td>
                  <td className="py-4 px-4 md:px-6">{statusBadge(order.status)}</td>
                  <td className="py-4 px-4 md:px-6">
                    <button
                      onClick={() => onView(order)}
                      className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                      title="Voir les détails de la commande"
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </CardContent>
  </Card>
);

export const B2BOrders: React.FC = () => {
  const { isAdmin } = useAdminAuth();
  const { orders, loading, error, refresh } = useB2BOrders(isAdmin);
  const { batches, markDeliveryAvailable } = useAdminDeliveryBatches(isAdmin);
  const [viewingOrder, setViewingOrder] = useState<B2BOrder | null>(null);
  const [markingBatchId, setMarkingBatchId] = useState<string | null>(null);

  // Après annulation d'un article, `orders` se rafraîchit mais `viewingOrder`
  // pointe encore sur l'ancien objet : on le resynchronise pour que la modal
  // ouverte reflète immédiatement le nouveau total et le statut de l'article.
  useEffect(() => {
    if (!viewingOrder) return;
    const updated = orders.find((o) => o.id === viewingOrder.id);
    if (updated) setViewingOrder(updated);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders]);

  const handleMarkAvailable = async (batchId: string) => {
    setMarkingBatchId(batchId);
    await markDeliveryAvailable(batchId);
    setMarkingBatchId(null);
  };

  const ordersByBatch = new Map<string, B2BOrder[]>();
  const unbatchedOrders: B2BOrder[] = [];
  for (const order of orders) {
    if (!order.batch_id) {
      unbatchedOrders.push(order);
      continue;
    }
    const list = ordersByBatch.get(order.batch_id) || [];
    list.push(order);
    ordersByBatch.set(order.batch_id, list);
  }
  const visibleBatches = batches.filter((b) => ordersByBatch.has(b.id));

  return (
    <div className="p-4 md:p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Commandes B2B</h3>
          <p className="text-sm text-gray-500">{loading ? 'Chargement...' : `${orders.length} commande${orders.length > 1 ? 's' : ''}`}</p>
        </div>
        <button
          onClick={refresh}
          className="flex items-center space-x-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
        >
          <RefreshCw className="h-4 w-4" />
          <span className="hidden sm:inline">Actualiser</span>
        </button>
      </div>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-center space-x-3">
          <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
          <p className="text-sm text-red-700">Erreur : {error}</p>
        </div>
      )}

      {!loading && !error && orders.length === 0 && (
        <div className="text-center py-12">
          <ShoppingBag className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Aucune commande B2B</h3>
          <p className="text-gray-500">Les commandes passées par vos revendeurs apparaîtront ici.</p>
        </div>
      )}

      {!loading && visibleBatches.map((batch) => {
        const batchOrders = ordersByBatch.get(batch.id) || [];
        return (
          <div key={batch.id} className="mb-8">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3 bg-gray-50 border border-gray-200 rounded-lg p-4">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-gray-900">{batch.reseller?.company_name || 'Revendeur'}</p>
                  {batchStatusBadge(batch.status)}
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Lot du {new Date(batch.created_at).toLocaleDateString('fr-FR')} — {batchOrders.length} commande{batchOrders.length > 1 ? 's' : ''} non expédiée{batchOrders.length > 1 ? 's' : ''}
                </p>
              </div>

              {batch.status === 'open' && (
                <button
                  onClick={() => handleMarkAvailable(batch.id)}
                  disabled={markingBatchId === batch.id}
                  className="flex items-center justify-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 text-sm flex-shrink-0"
                >
                  <Truck className="h-4 w-4" />
                  <span>{markingBatchId === batch.id ? 'Mise à jour...' : 'Livraison disponible'}</span>
                </button>
              )}
            </div>

            <OrdersTable orders={batchOrders} loading={false} showReseller={false} onView={setViewingOrder} />
          </div>
        );
      })}

      {(unbatchedOrders.length > 0 || loading) && (
        <div>
          {visibleBatches.length > 0 && <h4 className="text-sm font-medium text-gray-700 mb-3">Autres commandes</h4>}
          <OrdersTable orders={unbatchedOrders} loading={loading} showReseller onView={setViewingOrder} />
        </div>
      )}

      <B2BOrderDetailModal
        order={viewingOrder}
        onClose={() => setViewingOrder(null)}
        onOrderUpdated={refresh}
      />
    </div>
  );
};
