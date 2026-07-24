import React, { useEffect, useState } from 'react';
import { Card, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { useAdminAuth } from '../../hooks/useAdminAuth';
import { useB2BOrders, B2BOrder } from '../../hooks/useB2BOrders';
import { B2BOrderDetailModal } from './b2b/B2BOrderDetailModal';
import { AlertCircle, RefreshCw, ShoppingBag, Eye } from 'lucide-react';

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

export const B2BOrders: React.FC = () => {
  const { isAdmin } = useAdminAuth();
  const { orders, loading, error, refresh } = useB2BOrders(isAdmin);
  const [viewingOrder, setViewingOrder] = useState<B2BOrder | null>(null);

  // Après annulation d'un article, `orders` se rafraîchit mais `viewingOrder`
  // pointe encore sur l'ancien objet : on le resynchronise pour que la modal
  // ouverte reflète immédiatement le nouveau total et le statut de l'article.
  useEffect(() => {
    if (!viewingOrder) return;
    const updated = orders.find((o) => o.id === viewingOrder.id);
    if (updated) setViewingOrder(updated);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders]);

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

      {(orders.length > 0 || loading) && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-3 px-4 md:px-6 font-medium text-gray-900 text-sm">Commande</th>
                    <th className="text-left py-3 px-4 md:px-6 font-medium text-gray-900 text-sm">Revendeur</th>
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
                        <td className="py-4 px-4 md:px-6" colSpan={6}>
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
                        <td className="py-4 px-4 md:px-6 text-sm text-gray-700">{order.reseller?.company_name || '—'}</td>
                        <td className="py-4 px-4 md:px-6 hidden md:table-cell text-sm text-gray-600">{order.order_items.length} pièce{order.order_items.length > 1 ? 's' : ''}</td>
                        <td className="py-4 px-4 md:px-6 text-sm font-semibold text-gray-900">{order.total_amount.toFixed(0)} €</td>
                        <td className="py-4 px-4 md:px-6">{statusBadge(order.status)}</td>
                        <td className="py-4 px-4 md:px-6">
                          <button
                            onClick={() => setViewingOrder(order)}
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
      )}

      <B2BOrderDetailModal
        order={viewingOrder}
        onClose={() => setViewingOrder(null)}
        onOrderUpdated={refresh}
      />
    </div>
  );
};
