import React, { useState } from 'react';
import { Card, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Modal } from '../ui/Modal';
import { useAdminAuth } from '../../hooks/useAdminAuth';
import { useB2BOrders, B2BOrder } from '../../hooks/useB2BOrders';
import { Check, X, AlertCircle, RefreshCw, ShoppingBag } from 'lucide-react';

const approvalBadge = (status: B2BOrder['approval_status']) => {
  switch (status) {
    case 'approved':
      return <Badge variant="success">Validée</Badge>;
    case 'rejected':
      return <Badge variant="danger">Rejetée</Badge>;
    default:
      return <Badge variant="warning">En attente</Badge>;
  }
};

export const B2BOrders: React.FC = () => {
  const { isAdmin } = useAdminAuth();
  const { orders, loading, error, actionError, refresh, approveOrder, rejectOrder } = useB2BOrders(isAdmin);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [rejectingOrder, setRejectingOrder] = useState<B2BOrder | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const handleApprove = async (order: B2BOrder) => {
    if (!window.confirm(`Valider la commande ${order.order_number} ? Les pièces seront marquées comme vendues.`)) return;
    setProcessingId(order.id);
    await approveOrder(order.id);
    setProcessingId(null);
  };

  const openRejectModal = (order: B2BOrder) => {
    setRejectingOrder(order);
    setRejectReason('');
  };

  const handleReject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectingOrder) return;
    setProcessingId(rejectingOrder.id);
    const result = await rejectOrder(rejectingOrder.id, rejectReason);
    setProcessingId(null);
    if (result.success) {
      setRejectingOrder(null);
    }
  };

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

      {(error || actionError) && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-center space-x-3">
          <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
          <p className="text-sm text-red-700">Erreur : {error || actionError}</p>
        </div>
      )}

      {!loading && !error && orders.length === 0 && (
        <div className="text-center py-12">
          <ShoppingBag className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Aucune commande B2B</h3>
          <p className="text-gray-500">Les commandes soumises par vos revendeurs apparaîtront ici.</p>
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
                        <td className="py-4 px-4 md:px-6">{approvalBadge(order.approval_status)}</td>
                        <td className="py-4 px-4 md:px-6">
                          {order.approval_status === 'pending_approval' ? (
                            <div className="flex items-center space-x-1">
                              <button
                                onClick={() => handleApprove(order)}
                                disabled={processingId === order.id}
                                className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors disabled:opacity-50"
                                title="Valider"
                              >
                                <Check className="h-4 w-4" />
                              </button>
                              <button
                                onClick={() => openRejectModal(order)}
                                disabled={processingId === order.id}
                                className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                                title="Rejeter"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </div>
                          ) : (
                            <span className="text-xs text-gray-400">—</span>
                          )}
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

      <Modal isOpen={!!rejectingOrder} onClose={() => setRejectingOrder(null)} title={`Rejeter ${rejectingOrder?.order_number || ''}`}>
        <form onSubmit={handleReject} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Motif (optionnel, visible par le revendeur)</label>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
              rows={3}
            />
          </div>
          <p className="text-xs text-gray-500">Les pièces réservées seront remises en vente dans le catalogue.</p>
          <div className="flex justify-end space-x-3">
            <button
              type="button"
              onClick={() => setRejectingOrder(null)}
              className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={processingId === rejectingOrder?.id}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
            >
              {processingId === rejectingOrder?.id ? 'Rejet...' : 'Confirmer le rejet'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
