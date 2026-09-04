import React, { useEffect, useState } from 'react';
import { X, AlertCircle, Plus, Package, CheckCircle2, Pencil, Trash2, Eye, EyeOff } from 'lucide-react';
import { Badge } from '../../ui/Badge';
import { SourcingMission, SourcingMissionInput } from '../../../hooks/useSourcingMissions';
import { useSourcingItems, SourcingItem } from '../../../hooks/useSourcingItems';
import { AddSourcingItemModal } from './AddSourcingItemModal';
import { CreateSourcingMissionModal } from './CreateSourcingMissionModal';

interface SourcingMissionDetailModalProps {
  mission: SourcingMission | null;
  onClose: () => void;
  onStatusChange: (status: 'active' | 'completed' | 'cancelled') => Promise<{ success: boolean; error?: string }>;
  onUpdateMission: (input: SourcingMissionInput) => Promise<{ success: boolean; error?: string }>;
  onPublishChange: (published: boolean) => Promise<{ success: boolean; error?: string }>;
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

/** Détail d'une mission de sourcing : cartouche avance/budget/marge, pièces
 * affectées à l'enveloppe d'achat, ajout d'une pièce, édition et clôture —
 * voir SourcingMissionsTab.tsx et 0091_b2b_sourcing_mission_budget_split.sql. */
export const SourcingMissionDetailModal: React.FC<SourcingMissionDetailModalProps> = ({ mission, onClose, onStatusChange, onUpdateMission, onPublishChange, onItemsChanged }) => {
  const { items, loading, error, addItem, addItems, setItemStatus, removeItem } = useSourcingItems(mission?.id || null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [statusError, setStatusError] = useState('');
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [publishError, setPublishError] = useState('');
  const [publishing, setPublishing] = useState(false);

  useEffect(() => {
    setStatusError('');
  }, [mission?.id]);

  if (!mission) return null;

  // Calculé directement à partir des pièces déjà chargées ici plutôt que
  // via mission.consumed_cost_amount (b2b_sourcing_mission_totals) : évite
  // tout décalage d'affichage le temps que la liste des missions se
  // rafraîchisse après un ajout — cas réel qui affichait 0,00 € juste après
  // avoir ajouté 10 pièces. Les pièces annulées n'ont jamais été réellement
  // achetées, donc exclues comme partout ailleurs dans ce module.
  const activeItems = items.filter((i) => i.status !== 'cancelled');
  const totalSpent = activeItems.reduce((sum, item) => sum + (Number(item.cost_price) || 0), 0);
  const remainingAfter = mission.allocated_cost_budget - totalSpent;
  const marginReal = mission.advance_amount - totalSpent;
  const consumedRatio = mission.allocated_cost_budget > 0 ? Math.min(totalSpent / mission.allocated_cost_budget, 1) : 0;
  const overBudget = remainingAfter < 0;
  const marginPercent = mission.advance_amount > 0 ? (marginReal / mission.advance_amount) * 100 : null;

  const handleAddItem = async (input: Parameters<typeof addItem>[0]) => {
    const result = await addItem(input);
    if (result.success) onItemsChanged();
    return result;
  };

  const handleAddItems = async (inputs: Parameters<typeof addItems>[0]) => {
    const result = await addItems(inputs);
    if (result.success) onItemsChanged();
    return result;
  };

  const handleTogglePublish = async () => {
    const nextPublished = !mission.is_published_to_reseller;
    if (nextPublished && !window.confirm('Rendre cette mission visible au revendeur dans son portail "Sourcing sur mesure" ? Seuls le titre, l\'avance et les pièces (hors coûts) lui seront montrés.')) {
      return;
    }
    setPublishing(true);
    setPublishError('');
    const result = await onPublishChange(nextPublished);
    setPublishing(false);
    if (!result.success) setPublishError(result.error || 'Erreur lors de la mise à jour de la visibilité');
  };

  const handleCloseMission = async () => {
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
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-gray-900 truncate">{mission.title}</h3>
              {mission.reference && <p className="text-xs text-gray-400 font-mono mt-0.5">Réf. {mission.reference}</p>}
              {mission.notes && <p className="text-xs text-gray-500 mt-0.5">{mission.notes}</p>}
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                onClick={() => setShowEditModal(true)}
                className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                title="Modifier la mission"
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded-lg transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          <div className="p-5 space-y-4 overflow-y-auto flex-1">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              {mission.is_published_to_reseller ? (
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="success">
                    <Eye className="h-3 w-3 mr-1" /> Visible par le revendeur
                  </Badge>
                  <button
                    onClick={handleTogglePublish}
                    disabled={publishing}
                    className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-900 underline disabled:opacity-50"
                  >
                    <EyeOff className="h-3.5 w-3.5" />
                    {publishing ? 'Masquage...' : 'Masquer'}
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleTogglePublish}
                  disabled={publishing}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 text-xs font-medium"
                >
                  <Eye className="h-3.5 w-3.5" />
                  {publishing ? 'Publication...' : 'Afficher au revendeur'}
                </button>
              )}
            </div>

            {publishError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center space-x-2">
                <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
                <p className="text-sm text-red-700">{publishError}</p>
              </div>
            )}

            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-center mb-3">
                <div>
                  <p className="text-xs text-gray-500">Avance client</p>
                  <p className="text-sm font-semibold text-gray-900">{mission.advance_amount.toFixed(2)} €</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Enveloppe d'achat</p>
                  <p className="text-sm font-semibold text-gray-900">{mission.allocated_cost_budget.toFixed(2)} €</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Dépensé (achats)</p>
                  <p className="text-sm font-semibold text-gray-900">{totalSpent.toFixed(2)} €</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Reste à dépenser</p>
                  <p className={`text-sm font-semibold ${overBudget ? 'text-red-600' : 'text-gray-900'}`}>{remainingAfter.toFixed(2)} €</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Marge réelle</p>
                  <p className={`text-sm font-semibold ${marginReal < 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {marginReal.toFixed(2)} €{marginPercent !== null && ` (${marginPercent.toFixed(0)}%)`}
                  </p>
                </div>
              </div>
              <div className="w-full h-2.5 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${overBudget ? 'bg-red-500' : consumedRatio >= 1 ? 'bg-amber-500' : 'bg-gray-900'}`}
                  style={{ width: `${consumedRatio * 100}%` }}
                />
              </div>
              <p className="text-xs text-gray-400 mt-1.5">
                {totalSpent.toFixed(2)} € / {mission.allocated_cost_budget.toFixed(2)} € sourcés
              </p>
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
                      <th className="text-right py-2 px-3 font-medium text-gray-500 text-xs">Coût d'achat</th>
                      <th className="text-left py-2 px-3 font-medium text-gray-500 text-xs">Statut</th>
                      <th className="text-right py-2 px-3 font-medium text-gray-500 text-xs"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      [...Array(2)].map((_, i) => (
                        <tr key={`skeleton-${i}`} className="border-b border-gray-50">
                          <td className="py-3 px-3" colSpan={4}>
                            <div className="h-4 w-full bg-gray-100 rounded animate-pulse" />
                          </td>
                        </tr>
                      ))
                    ) : items.length === 0 ? (
                      <tr>
                        <td className="py-6 px-3 text-center text-sm text-gray-500" colSpan={4}>
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
                              {item.cost_price != null ? `${item.cost_price.toFixed(2)} €` : '—'}
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
                            <td className="py-2.5 px-3 text-right">
                              <button
                                type="button"
                                onClick={() => removeItem(item.id).then(onItemsChanged)}
                                className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                title="Retirer cette pièce de la mission"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
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
                onClick={handleCloseMission}
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

      <AddSourcingItemModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSubmit={handleAddItem}
        onSubmitBatch={handleAddItems}
        remainingCostBudget={mission.remaining_cost_budget}
      />

      <CreateSourcingMissionModal
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        onSubmit={onUpdateMission}
        editingMission={mission}
      />
    </div>
  );
};

export default SourcingMissionDetailModal;
