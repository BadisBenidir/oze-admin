import React, { useState } from 'react';
import { X, Package, Trash2, AlertCircle, AlertTriangle } from 'lucide-react';
import { Badge } from '../../ui/Badge';
import { B2BOrder, B2BOrderItem } from '../../../hooks/useB2BOrders';
import { cancelOrderItem } from '../../../hooks/useCancelOrderItem';

const CANCEL_REASONS = [
  'Rupture de stock / Article introuvable',
  'Défaut majeur découvert avant envoi',
  'Demande du client',
] as const;

const RESTOCK_OPTIONS: { value: 'draft' | 'for-sale-b2b' | 'archived'; label: string }[] = [
  { value: 'draft', label: 'Remettre en brouillon' },
  { value: 'for-sale-b2b', label: 'Remettre au catalogue B2B' },
  { value: 'archived', label: "Archiver l'article" },
];

const orderStatusBadge = (status: string) => {
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

interface CancelItemPanelProps {
  item: B2BOrderItem;
  onCancel: () => void;
  onConfirmed: (result: { new_total_amount?: number; order_status?: string; refund_status?: string; refund_error?: string }) => void;
}

const CancelItemPanel: React.FC<CancelItemPanelProps> = ({ item, onCancel, onConfirmed }) => {
  const [reason, setReason] = useState<string>(CANCEL_REASONS[0]);
  const [restockAction, setRestockAction] = useState<'draft' | 'for-sale-b2b' | 'archived'>('draft');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleConfirm = async () => {
    setSubmitting(true);
    setError('');
    const result = await cancelOrderItem(item.id, reason, restockAction);
    setSubmitting(false);

    if (!result.success) {
      setError(result.error || "Impossible d'annuler cet article");
      return;
    }
    onConfirmed(result);
  };

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto">
      <div className="fixed inset-0 bg-black bg-opacity-50" onClick={onCancel} />
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between p-5 border-b border-gray-100">
            <h3 className="text-base font-semibold text-gray-900">Annuler cet article</h3>
            <button onClick={onCancel} className="p-1 text-gray-400 hover:text-gray-600 rounded-lg transition-colors">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="p-5 space-y-4">
            <div className="bg-gray-50 rounded-lg p-3 flex items-center gap-3">
              <div className="h-10 w-10 bg-white rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden border border-gray-100">
                {item.product_snapshot?.images?.[0] ? (
                  <img src={item.product_snapshot.images[0]} alt="" className="h-full w-full object-cover" />
                ) : (
                  <Package className="h-4 w-4 text-gray-300" />
                )}
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">{item.product_snapshot?.name || 'Produit'}</p>
                <p className="text-xs text-gray-500">{item.line_total.toFixed(0)} €</p>
              </div>
            </div>

            <div>
              <label htmlFor="cancel-reason" className="block text-sm font-medium text-gray-700 mb-2">
                Raison de l'annulation
              </label>
              <select
                id="cancel-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-gray-400 text-sm bg-white"
              >
                {CANCEL_REASONS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Que faire de l'article ?</label>
              <div className="space-y-2">
                {RESTOCK_OPTIONS.map((opt) => (
                  <label key={opt.value} className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="radio"
                      name="restock-action"
                      value={opt.value}
                      checked={restockAction === opt.value}
                      onChange={() => setRestockAction(opt.value)}
                      className="h-4 w-4 text-gray-900 focus:ring-gray-900"
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
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
              onClick={onCancel}
              disabled={submitting}
              className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors text-sm disabled:opacity-50"
            >
              Retour
            </button>
            <button
              onClick={handleConfirm}
              disabled={submitting}
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

interface B2BOrderDetailModalProps {
  order: B2BOrder | null;
  onClose: () => void;
  /** Rafraîchit la liste des commandes du parent après une annulation d'article. */
  onOrderUpdated: () => void;
}

export const B2BOrderDetailModal: React.FC<B2BOrderDetailModalProps> = ({ order, onClose, onOrderUpdated }) => {
  const [cancellingItem, setCancellingItem] = useState<B2BOrderItem | null>(null);
  const [refundNotice, setRefundNotice] = useState<string | null>(null);

  if (!order) return null;

  const handleConfirmed = (result: { refund_status?: string; refund_error?: string }) => {
    setCancellingItem(null);
    if (result.refund_status === 'succeeded') {
      setRefundNotice('Article annulé et remboursement Stripe effectué avec succès.');
    } else if (result.refund_status === 'failed') {
      setRefundNotice(`Article annulé, mais le remboursement Stripe a échoué (${result.refund_error || 'erreur inconnue'}) — à traiter manuellement depuis le dashboard Stripe.`);
    } else {
      setRefundNotice(null);
    }
    onOrderUpdated();
  };

  return (
    <>
      <div className="fixed inset-0 z-50 overflow-y-auto">
        <div className="flex min-h-full items-center justify-center p-4">
          <div className="fixed inset-0 bg-black bg-opacity-25" onClick={onClose} />

          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between p-6 border-b border-gray-100">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">#{order.order_number}</h3>
                <p className="text-sm text-gray-500 mt-1">
                  {new Date(order.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}
                  {order.reseller?.company_name ? ` · ${order.reseller.company_name}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-3">
                {orderStatusBadge(order.status)}
                <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg transition-colors">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="p-6 space-y-6">
              {refundNotice && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-blue-600 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-blue-800">{refundNotice}</p>
                </div>
              )}

              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Articles</p>
                <div className="border border-gray-100 rounded-lg overflow-hidden">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-100">
                        <th className="text-left py-2.5 px-4 font-medium text-gray-500 text-xs">Produit</th>
                        <th className="text-right py-2.5 px-4 font-medium text-gray-500 text-xs">Total</th>
                        <th className="text-right py-2.5 px-4 font-medium text-gray-500 text-xs">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {order.order_items.map((item) => {
                        const isCancelled = item.status === 'cancelled';
                        const image = item.product_snapshot?.images?.[item.product_snapshot?.main_image_index ?? 0] || item.product_snapshot?.images?.[0];
                        return (
                          <tr key={item.id} className="border-b border-gray-50 last:border-b-0">
                            <td className="py-3 px-4">
                              <div className="flex items-center gap-3">
                                <div className={`h-10 w-10 bg-gray-100 rounded-lg flex items-center justify-center overflow-hidden flex-shrink-0 ${isCancelled ? 'opacity-40' : ''}`}>
                                  {image ? (
                                    <img src={image} alt={item.product_snapshot?.name} className="h-full w-full object-cover" />
                                  ) : (
                                    <Package className="h-4 w-4 text-gray-300" />
                                  )}
                                </div>
                                <div>
                                  <span className={`text-sm font-medium ${isCancelled ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
                                    {item.product_snapshot?.name || 'Produit'}
                                  </span>
                                  {isCancelled && (
                                    <div className="mt-1 flex items-center gap-2 flex-wrap">
                                      <Badge variant="danger">Article annulé</Badge>
                                      {item.cancellation_reason && (
                                        <span className="text-xs text-gray-400">{item.cancellation_reason}</span>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className={`py-3 px-4 text-right text-sm font-semibold ${isCancelled ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
                              {item.line_total.toFixed(0)} €
                            </td>
                            <td className="py-3 px-4 text-right">
                              {!isCancelled && (
                                <button
                                  onClick={() => setCancellingItem(item)}
                                  className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                  title="Annuler cet article"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex justify-end">
                <div className="w-full sm:w-64 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Sous-total</span>
                    <span className="text-gray-900">{order.subtotal.toFixed(0)} €</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Livraison</span>
                    <span className="text-gray-900">{order.shipping_cost.toFixed(0)} €</span>
                  </div>
                  <div className="flex justify-between text-base font-semibold border-t border-gray-100 pt-2">
                    <span className="text-gray-900">Total net</span>
                    <span className="text-gray-900">{order.total_amount.toFixed(0)} €</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {cancellingItem && (
        <CancelItemPanel
          item={cancellingItem}
          onCancel={() => setCancellingItem(null)}
          onConfirmed={handleConfirmed}
        />
      )}
    </>
  );
};
