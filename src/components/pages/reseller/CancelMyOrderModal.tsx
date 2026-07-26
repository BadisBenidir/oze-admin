import React, { useState } from 'react';
import { X, AlertCircle, CheckCircle2, ImageOff } from 'lucide-react';
import { MyB2BOrder } from '../../../hooks/useMyB2BOrders';
import { cancelMyOrder } from '../../../hooks/useCancelMyB2BOrder';

interface CancelMyOrderModalProps {
  order: MyB2BOrder;
  onClose: () => void;
  /** Rafraîchit la liste des commandes du parent après une annulation réussie. */
  onCancelled: () => void;
}

// Sélection "toute la commande" par défaut ou "certains articles" — toujours
// remboursé en crédit portefeuille (règle fixe côté client, voir
// cancel-my-b2b-order-item), jamais de choix de méthode ici contrairement à
// l'admin.
export const CancelMyOrderModal: React.FC<CancelMyOrderModalProps> = ({ order, onClose, onCancelled }) => {
  const activeItems = order.order_items.filter((i) => i.status === 'active');
  const [mode, setMode] = useState<'all' | 'select'>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(activeItems.map((i) => i.id)));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState<{ count: number; total: number } | null>(null);

  const toggleItem = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const targetItems = mode === 'all' ? activeItems : activeItems.filter((i) => selectedIds.has(i.id));
  const totalRefund = targetItems.reduce((sum, i) => sum + i.line_total, 0);

  const handleConfirm = async () => {
    if (targetItems.length === 0) {
      setError('Sélectionnez au moins un article à annuler.');
      return;
    }
    setSubmitting(true);
    setError('');
    const result = await cancelMyOrder(order.id, mode === 'all' ? undefined : targetItems.map((i) => i.id));
    setSubmitting(false);

    if (!result.success) {
      setError(result.error || "Impossible d'annuler cette commande");
      return;
    }
    setSuccess({ count: result.cancelled_item_count || targetItems.length, total: result.total_refund ?? totalRefund });
    onCancelled();
  };

  if (success) {
    return (
      <div className="fixed inset-0 z-[60] overflow-y-auto">
        <div className="fixed inset-0 bg-black bg-opacity-50" onClick={onClose} />
        <div className="flex min-h-full items-center justify-center p-4">
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-sm p-6 text-center" onClick={(e) => e.stopPropagation()}>
            <CheckCircle2 className="h-10 w-10 text-green-600 mx-auto mb-3" />
            <h3 className="text-base font-semibold text-gray-900 mb-1">Annulation confirmée</h3>
            <p className="text-sm text-gray-600">
              {success.count} article{success.count > 1 ? 's' : ''} annulé{success.count > 1 ? 's' : ''} — {success.total.toFixed(2)} € recrédités sur votre solde portefeuille.
            </p>
            <button
              onClick={onClose}
              className="mt-5 w-full px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors text-sm font-medium"
            >
              Fermer
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto">
      <div className="fixed inset-0 bg-black bg-opacity-50" onClick={onClose} />
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between p-5 border-b border-gray-100">
            <h3 className="text-base font-semibold text-gray-900">Annuler la commande #{order.order_number}</h3>
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded-lg transition-colors">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="p-5 space-y-4">
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="radio"
                  name="cancel-mode"
                  checked={mode === 'all'}
                  onChange={() => setMode('all')}
                  className="h-4 w-4 text-gray-900 focus:ring-gray-900"
                />
                Annuler toute la commande
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="radio"
                  name="cancel-mode"
                  checked={mode === 'select'}
                  onChange={() => setMode('select')}
                  className="h-4 w-4 text-gray-900 focus:ring-gray-900"
                />
                Choisir les articles à annuler
              </label>
            </div>

            <div className="border border-gray-100 rounded-lg divide-y divide-gray-50 max-h-56 overflow-y-auto">
              {activeItems.map((item) => {
                const image = item.product_snapshot?.images?.[item.product_snapshot?.main_image_index ?? 0] || item.product_snapshot?.images?.[0];
                const checked = mode === 'all' || selectedIds.has(item.id);
                return (
                  <label
                    key={item.id}
                    className={`flex items-center gap-3 px-3 py-2 ${mode === 'select' ? 'cursor-pointer hover:bg-gray-50' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={mode === 'all'}
                      onChange={() => toggleItem(item.id)}
                      className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-400 disabled:opacity-50"
                    />
                    <div className="h-8 w-8 bg-gray-100 rounded flex items-center justify-center overflow-hidden flex-shrink-0">
                      {image ? (
                        <img src={image} alt={item.product_snapshot?.name} className="w-full h-full object-cover" />
                      ) : (
                        <ImageOff className="h-3 w-3 text-gray-300" />
                      )}
                    </div>
                    <span className="text-sm text-gray-700 flex-1 truncate">{item.product_snapshot?.name}</span>
                    <span className="text-sm font-medium text-gray-900">{item.line_total.toFixed(0)} €</span>
                  </label>
                );
              })}
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="text-sm text-amber-900">
                Montant remboursé : <span className="font-semibold">{totalRefund.toFixed(2)} €</span> en crédit portefeuille B2B.
              </p>
              <p className="text-xs text-amber-700 mt-1">
                Les articles annulés seront immédiatement remis en vente dans le catalogue B2B.
              </p>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center space-x-2">
                <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3 p-5 pt-0">
            <button
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors text-sm disabled:opacity-50"
            >
              Retour
            </button>
            <button
              onClick={handleConfirm}
              disabled={submitting || targetItems.length === 0}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm font-medium disabled:opacity-50"
            >
              {submitting ? 'Annulation...' : "Confirmer l'annulation"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
