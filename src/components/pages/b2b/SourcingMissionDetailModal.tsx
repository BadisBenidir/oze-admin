import React, { useEffect, useState } from 'react';
import { X, AlertCircle, Plus, Package, CheckCircle2 } from 'lucide-react';
import { Badge } from '../../ui/Badge';
import { SourcingMission } from '../../../hooks/useSourcingMissions';
import { useSourcingItems, SourcingItem } from '../../../hooks/useSourcingItems';
import { AddSourcingItemModal } from './AddSourcingItemModal';

interface SourcingMissionDetailModalProps {
  mission: SourcingMission | null;
  onClose: () => void;
  onStatusChange: (status: 'active' | 'completed' | 'cancelled') => Promise<{ success: boolean; error?: string }>;
  /** Rafraîchit la liste des missions (montants consommés) après ajout d'une pièce. */
  onItemsChanged: () => void;
}

const itemStatusBadge = (status: SourcingItem['status']) => {
  switch (status) {
    case 'validated':
      return <Badge variant="info">Validée</Badge>;
    case 'shipped':
      return <Badge variant="success">Expédiée</Badge>;
    case 'cancelled':
      return <Badge variant="danger">Annulée</Badge>;
    default:
      return <Badge variant="warning">Sourcée</Badge>;
  }
};

/** Détail d'une mission de sourcing : pièces affectées à son budget, ajout
 * d'une nouvelle pièce, et clôture — voir SourcingMissionsTab.tsx. */
export const SourcingMissionDetailModal: React.FC<SourcingMissionDetailModalProps> = ({ mission, onClose, onStatusChange, onItemsChanged }) => {
  const { items, loading, error, addItem, setItemStatus } = useSourcingItems(mission?.id || null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [statusError, setStatusError] = useState('');
  const [updatingStatus, setUpdatingStatus] = useState(false);

  useEffect(() => {
    setStatusError('');
  }, [mission?.id]);

  if (!mission) return null;

  const consumedRatio = mission.budget_amount > 0 ? Math.min(mission.consumed_amount / mission.budget_amount, 1) : 0;
  const overBudget = mission.remaining_amount < 0;

  const handleAddItem = async (input: Parameters<typeof addItem>[0]) => {
    const result = await addItem(input);
    if (result.success) onItemsChanged();
    return result;
  };

  const handleClose = async () => {
    setUpdatingStatus(true);
    setStatusError('');
    const result = await onStatusChange('completed');
    setUpdatingStatus(false);
    if (!result.success) setStatusError(result.error || 'Erreur lors de la clôture');
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black bg-opacity-25" onClick={onClose} />
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between p-5 border-b border-gray-100 flex-shrink-0">
            <div>
              <h3 className="text-base font-semibold text-gray-900">{mission.title}</h3>
              {mission.notes && <p className="text-xs text-gray-500 mt-0.5">{mission.notes}</p>}
            </div>
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded-lg transition-colors flex-shrink-0">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="p-5 space-y-4 overflow-y-auto flex-1">
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <div className="w-full h-2.5 bg-gray-200 rounded-full overflow-hidden mb-2">
                <div
                  className={`h-full rounded-full ${overBudget ? 'bg-red-500' : consumedRatio >= 1 ? 'bg-amber-500' : 'bg-gray-900'}`}
                  style={{ width: `${consumedRatio * 100}%` }}
                />
              </div>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div>
                  <p className="text-xs text-gray-500">Budget initial</p>
                  <p className="text-sm font-semibold text-gray-900">{mission.budget_amount.toFixed(2)} €</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Consommé</p>
                  <p className="text-sm font-semibold text-gray-900">{mission.consumed_amount.toFixed(2)} €</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Reste à consommer</p>
                  <p className={`text-sm font-semibold ${overBudget ? 'text-red-600' : 'text-gray-900'}`}>{mission.remaining_amount.toFixed(2)} €</p>
                </div>
              </div>
            </div>

            {statusError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center space-x-2">
                <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
                <p className="text-sm text-red-700">{statusError}</p>
              </div>
            )}

            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-gray-900">Pièces sourcées ({items.length})</p>
              <button
                onClick={() => setShowAddModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors text-xs font-medium"
              >
                <Plus className="h-3.5 w-3.5" />
                Ajouter une pièce
              </button>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center space-x-2">
                <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            <div className="border border-gray-100 rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="text-left py-2 px-3 font-medium text-gray-500 text-xs">Pièce</th>
                      <th className="text-right py-2 px-3 font-medium text-gray-500 text-xs">Prix facturé</th>
                      <th className="text-left py-2 px-3 font-medium text-gray-500 text-xs">Statut</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      [...Array(2)].map((_, i) => (
                        <tr key={`skeleton-${i}`} className="border-b border-gray-50">
                          <td className="py-3 px-3" colSpan={3}>
                            <div className="h-4 w-full bg-gray-100 rounded animate-pulse" />
                          </td>
                        </tr>
                      ))
                    ) : items.length === 0 ? (
                      <tr>
                        <td className="py-6 px-3 text-center text-sm text-gray-500" colSpan={3}>
                          Aucune pièce sourcée pour l'instant sur cette mission.
                        </td>
                      </tr>
                    ) : (
                      items.map((item) => {
                        const photo = item.photos?.[0] || item.product?.images?.[item.product.main_image_index] || item.product?.images?.[0];
                        return (
                          <tr key={item.id} className="border-b border-gray-50 last:border-b-0">
                            <td className="py-2.5 px-3">
                              <div className="flex items-center gap-2.5">
                                <div className="h-9 w-9 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden">
                                  {photo ? (
                                    <img src={photo} alt={item.title} className="h-full w-full object-cover" />
                                  ) : (
                                    <Package className="h-4 w-4 text-gray-400" />
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <p className="text-sm font-medium text-gray-900 truncate">{item.title}</p>
                                  {item.brand && <p className="text-xs text-gray-500">{item.brand}</p>}
                                </div>
                              </div>
                            </td>
                            <td className="py-2.5 px-3 text-right text-sm font-medium text-gray-900 tabular-nums">
                              {item.billed_price.toFixed(2)} €
                            </td>
                            <td className="py-2.5 px-3">
                              <select
                                value={item.status}
                                onChange={(e) => setItemStatus(item.id, e.target.value as SourcingItem['status']).then(onItemsChanged)}
                                className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white focus:outline-none focus:border-gray-400"
                              >
                                <option value="sourced">Sourcée</option>
                                <option value="validated">Validée</option>
                                <option value="shipped">Expédiée</option>
                                <option value="cancelled">Annulée</option>
                              </select>
                              <span className="ml-2 align-middle">{itemStatusBadge(item.status)}</span>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between p-5 pt-4 border-t border-gray-100 flex-shrink-0">
            <span className="text-xs text-gray-400">
              {mission.status === 'completed' ? 'Mission clôturée' : mission.status === 'cancelled' ? 'Mission annulée' : 'Mission active'}
            </span>
            {mission.status === 'active' && (
              <button
                onClick={handleClose}
                disabled={updatingStatus}
                className="flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 text-sm font-medium"
              >
                <CheckCircle2 className="h-4 w-4" />
                {updatingStatus ? 'Clôture...' : 'Clôturer la mission'}
              </button>
            )}
          </div>
        </div>
      </div>

      <AddSourcingItemModal isOpen={showAddModal} onClose={() => setShowAddModal(false)} onSubmit={handleAddItem} />
    </div>
  );
};

export default SourcingMissionDetailModal;
