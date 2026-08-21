import React, { useState } from 'react';
import { useResellerAuth } from '../../../hooks/useResellerAuth';
import { useMyB2BOrders } from '../../../hooks/useMyB2BOrders';
import { useReadyToShipItems } from '../../../hooks/useReadyToShipItems';
import { B2BOrdersList } from './B2BOrdersList';
import { RequestDeliveryModal } from './RequestDeliveryModal';
import { ImageOff, Truck } from 'lucide-react';

interface MyOrdersProps {
  onOpenProduct: (productId: string) => void;
  /** Rafraîchit le solde affiché dans l'en-tête après un remboursement (annulation). */
  onWalletChanged?: () => void;
}

export const MyOrders: React.FC<MyOrdersProps> = ({ onOpenProduct, onWalletChanged }) => {
  const { isReseller, profile } = useResellerAuth();
  const { orders, loading, error, refresh } = useMyB2BOrders(isReseller, profile?.id);
  const { items: readyItems, requestDelivery } = useReadyToShipItems(isReseller);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showRequestModal, setShowRequestModal] = useState(false);

  const handleOrderCancelled = () => {
    refresh();
    onWalletChanged?.();
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) => (prev.size === readyItems.length ? new Set() : new Set(readyItems.map((i) => i.id))));
  };

  const handleSubmitRequest = async (deliveryType: Parameters<typeof requestDelivery>[1], parcelPoint: Parameters<typeof requestDelivery>[2], instructions: string | null) => {
    const result = await requestDelivery(Array.from(selected), deliveryType, parcelPoint, instructions);
    if (result.success) setSelected(new Set());
    return result;
  };

  return (
    <div className="p-4 md:p-6">
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-gray-900">Mes commandes</h3>
        <p className="text-sm text-gray-500">{loading ? 'Chargement...' : `${orders.length} commande${orders.length > 1 ? 's' : ''}`}</p>
      </div>

      {readyItems.length > 0 && (
        <div className="mb-8">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3 bg-gray-50 border border-gray-200 rounded-lg p-4">
            <div>
              <p className="text-sm font-medium text-gray-900">Prêts à être expédiés</p>
              <p className="text-xs text-gray-500 mt-1">
                {readyItems.length} article{readyItems.length > 1 ? 's' : ''} disponible{readyItems.length > 1 ? 's' : ''}
              </p>
            </div>
            <button
              onClick={() => setShowRequestModal(true)}
              disabled={selected.size === 0}
              className="flex items-center justify-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-sm flex-shrink-0"
            >
              <Truck className="h-4 w-4" />
              <span>Demander la livraison{selected.size > 0 ? ` (${selected.size})` : ''}</span>
            </button>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <label className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-100 bg-gray-50 cursor-pointer">
              <input
                type="checkbox"
                checked={selected.size === readyItems.length}
                onChange={toggleAll}
                className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-400"
              />
              <span className="text-xs font-medium text-gray-600">Tout sélectionner</span>
            </label>
            {readyItems.map((item) => {
              const image = item.product_snapshot?.images?.[item.product_snapshot?.main_image_index ?? 0] || item.product_snapshot?.images?.[0];
              return (
                <label key={item.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-50 last:border-b-0 cursor-pointer hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={selected.has(item.id)}
                    onChange={() => toggle(item.id)}
                    className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-400 flex-shrink-0"
                  />
                  <div className="h-9 w-9 bg-gray-100 rounded flex items-center justify-center overflow-hidden flex-shrink-0">
                    {image ? <img src={image} alt={item.product_snapshot?.name} className="h-full w-full object-cover" /> : <ImageOff className="h-4 w-4 text-gray-300" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-gray-900 truncate">{item.product_snapshot?.name || 'Article'}</p>
                    <p className="text-xs text-gray-400 font-mono">{item.order?.order_number}</p>
                  </div>
                  <span className="text-sm font-medium text-gray-900 flex-shrink-0">{item.line_total.toFixed(0)} €</span>
                </label>
              );
            })}
          </div>
        </div>
      )}

      <B2BOrdersList
        orders={orders}
        loading={loading}
        error={error}
        emptyMessage="Vos commandes passées depuis le catalogue apparaîtront ici."
        onOpenProduct={onOpenProduct}
        canCancel
        onOrderCancelled={handleOrderCancelled}
      />

      {showRequestModal && (
        <RequestDeliveryModal
          items={readyItems.filter((i) => selected.has(i.id))}
          onClose={() => setShowRequestModal(false)}
          onSubmit={handleSubmitRequest}
        />
      )}
    </div>
  );
};
