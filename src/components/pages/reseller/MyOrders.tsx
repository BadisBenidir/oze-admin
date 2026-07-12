import React from 'react';
import { Card, CardContent } from '../../ui/Card';
import { Badge } from '../../ui/Badge';
import { useResellerAuth } from '../../../hooks/useResellerAuth';
import { useMyB2BOrders } from '../../../hooks/useMyB2BOrders';
import { ShoppingBag, ImageOff, AlertCircle } from 'lucide-react';

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

export const MyOrders: React.FC = () => {
  const { isReseller } = useResellerAuth();
  const { orders, loading, error } = useMyB2BOrders(isReseller);

  return (
    <div className="p-4 md:p-6">
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-gray-900">Mes commandes</h3>
        <p className="text-sm text-gray-500">{loading ? 'Chargement...' : `${orders.length} commande${orders.length > 1 ? 's' : ''}`}</p>
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
          <h3 className="text-lg font-medium text-gray-900 mb-2">Aucune commande</h3>
          <p className="text-gray-500">Vos commandes passées depuis le catalogue apparaîtront ici.</p>
        </div>
      )}

      <div className="space-y-4">
        {loading
          ? [...Array(2)].map((_, i) => (
              <Card key={`skeleton-${i}`}>
                <CardContent className="p-4">
                  <div className="h-4 w-40 bg-gray-100 rounded animate-pulse mb-2" />
                  <div className="h-4 w-24 bg-gray-100 rounded animate-pulse" />
                </CardContent>
              </Card>
            ))
          : orders.map((order) => (
              <Card key={order.id}>
                <CardContent className="p-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                    <div>
                      <p className="font-medium text-gray-900">{order.order_number}</p>
                      <p className="text-xs text-gray-500">{new Date(order.created_at).toLocaleDateString('fr-FR')}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {statusBadge(order.status)}
                      <span className="text-base font-semibold text-gray-900">{order.total_amount.toFixed(0)} €</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {order.order_items.map((item) => {
                      const image = item.product_snapshot?.images?.[item.product_snapshot?.main_image_index ?? 0] || item.product_snapshot?.images?.[0];
                      return (
                        <div key={item.id} className="flex items-center gap-2 bg-gray-50 rounded-lg px-2 py-1">
                          <div className="h-8 w-8 bg-gray-100 rounded flex items-center justify-center overflow-hidden flex-shrink-0">
                            {image ? (
                              <img src={image} alt={item.product_snapshot?.name} className="w-full h-full object-cover" />
                            ) : (
                              <ImageOff className="h-3 w-3 text-gray-300" />
                            )}
                          </div>
                          <span className="text-xs text-gray-700 max-w-[120px] truncate">{item.product_snapshot?.name}</span>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            ))}
      </div>
    </div>
  );
};
