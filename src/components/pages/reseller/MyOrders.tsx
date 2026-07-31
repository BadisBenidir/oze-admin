import React, { useState } from 'react';
import { useResellerAuth } from '../../../hooks/useResellerAuth';
import { useMyB2BOrders, MyB2BOrder } from '../../../hooks/useMyB2BOrders';
import { useDeliveryBatches, DeliveryBatch } from '../../../hooks/useDeliveryBatches';
import { B2BOrdersList } from './B2BOrdersList';
import { RequestDeliveryModal } from './RequestDeliveryModal';
import { Badge } from '../../ui/Badge';
import { Truck, Clock } from 'lucide-react';

interface MyOrdersProps {
  onOpenProduct: (productId: string) => void;
  /** Rafraîchit le solde affiché dans l'en-tête après un remboursement (annulation). */
  onWalletChanged?: () => void;
}

const batchStatusBadge = (status: DeliveryBatch['status']) => {
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

export const MyOrders: React.FC<MyOrdersProps> = ({ onOpenProduct, onWalletChanged }) => {
  const { isReseller, profile } = useResellerAuth();
  const { orders, loading, error, refresh } = useMyB2BOrders(isReseller, profile?.id);
  const { batches, requestDelivery } = useDeliveryBatches(isReseller);
  const [requestingBatch, setRequestingBatch] = useState<DeliveryBatch | null>(null);

  const handleOrderCancelled = () => {
    refresh();
    onWalletChanged?.();
  };

  const ordersByBatch = new Map<string, MyB2BOrder[]>();
  const unbatchedOrders: MyB2BOrder[] = [];
  for (const order of orders) {
    if (!order.batch_id) {
      unbatchedOrders.push(order);
      continue;
    }
    const list = ordersByBatch.get(order.batch_id) || [];
    list.push(order);
    ordersByBatch.set(order.batch_id, list);
  }

  // Seuls les lots ayant au moins une commande visible ici sont affichés —
  // un lot 'open' fraîchement créé sans commande confirmée n'a rien à montrer.
  const visibleBatches = batches.filter((b) => ordersByBatch.has(b.id));

  return (
    <div className="p-4 md:p-6">
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-gray-900">Mes commandes</h3>
        <p className="text-sm text-gray-500">{loading ? 'Chargement...' : `${orders.length} commande${orders.length > 1 ? 's' : ''}`}</p>
      </div>

      {!loading && visibleBatches.map((batch) => {
        const batchOrders = ordersByBatch.get(batch.id) || [];
        return (
          <div key={batch.id} className="mb-8">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3 bg-gray-50 border border-gray-200 rounded-lg p-4">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-gray-900">
                    Lot du {new Date(batch.created_at).toLocaleDateString('fr-FR')}
                  </p>
                  {batchStatusBadge(batch.status)}
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {batchOrders.length} commande{batchOrders.length > 1 ? 's' : ''} non expédiée{batchOrders.length > 1 ? 's' : ''}
                </p>
              </div>

              {batch.status === 'requested' ? (
                <p className="text-xs text-gray-500 flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" />
                  Demandée le {batch.requested_at ? new Date(batch.requested_at).toLocaleDateString('fr-FR') : ''}
                </p>
              ) : (
                <button
                  onClick={() => setRequestingBatch(batch)}
                  disabled={batch.status !== 'delivery_available'}
                  title={batch.status !== 'delivery_available' ? "En attente de préparation par OZË Paris" : undefined}
                  className="flex items-center justify-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-sm flex-shrink-0"
                >
                  <Truck className="h-4 w-4" />
                  <span>Demander la livraison</span>
                </button>
              )}
            </div>

            <B2BOrdersList
              orders={batchOrders}
              loading={false}
              error={null}
              onOpenProduct={onOpenProduct}
              canCancel
              onOrderCancelled={handleOrderCancelled}
            />
          </div>
        );
      })}

      {(loading || unbatchedOrders.length > 0 || visibleBatches.length === 0) && (
        <div>
          {visibleBatches.length > 0 && <h4 className="text-sm font-medium text-gray-700 mb-3">Historique</h4>}
          <B2BOrdersList
            orders={unbatchedOrders}
            loading={loading}
            error={error}
            emptyMessage="Vos commandes passées depuis le catalogue apparaîtront ici."
            onOpenProduct={onOpenProduct}
            canCancel
            onOrderCancelled={handleOrderCancelled}
          />
        </div>
      )}

      {requestingBatch && (
        <RequestDeliveryModal
          batch={requestingBatch}
          orderCount={(ordersByBatch.get(requestingBatch.id) || []).length}
          onClose={() => setRequestingBatch(null)}
          onSubmit={(deliveryType, parcelPoint, instructions) => requestDelivery(requestingBatch.id, deliveryType, parcelPoint, instructions)}
        />
      )}
    </div>
  );
};
