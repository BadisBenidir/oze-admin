import React, { useEffect, useState } from 'react';
import { Plus, Briefcase, AlertCircle } from 'lucide-react';
import { Card, CardContent } from '../../ui/Card';
import { Badge } from '../../ui/Badge';
import { useSourcingMissions, SourcingMission } from '../../../hooks/useSourcingMissions';
import { CreateSourcingMissionModal } from './CreateSourcingMissionModal';
import { SourcingMissionDetailModal } from './SourcingMissionDetailModal';

interface SourcingMissionsTabProps {
  resellerId: string;
  resellerName: string;
  isAdmin: boolean;
}

const missionStatusBadge = (status: SourcingMission['status']) => {
  switch (status) {
    case 'completed':
      return <Badge variant="success">Terminée</Badge>;
    case 'cancelled':
      return <Badge variant="danger">Annulée</Badge>;
    default:
      return <Badge variant="info">Active</Badge>;
  }
};

/** Onglet "Sourcing sur mesure" de la fiche revendeur — voir
 * 0089_b2b_sourcing_missions.sql. Une mission = une avance versée par le
 * revendeur, servant d'enveloppe budgétaire pour des pièces sourcées à la
 * demande (voir SourcingMissionDetailModal pour le détail des pièces). */
export const SourcingMissionsTab: React.FC<SourcingMissionsTabProps> = ({ resellerId, resellerName, isAdmin }) => {
  const { missions, loading, error, refresh, createMission, updateMission, setMissionStatus } = useSourcingMissions(resellerId, isAdmin);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [viewingMission, setViewingMission] = useState<SourcingMission | null>(null);

  // Garde la mission ouverte synchronisée avec la liste (statut, ajout de
  // pièce, ou édition changent tous les montants affichés dans le détail).
  useEffect(() => {
    if (!viewingMission) return;
    const updated = missions.find((m) => m.id === viewingMission.id);
    if (updated) setViewingMission(updated);
  }, [missions, viewingMission]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <p className="text-sm text-gray-500 max-w-xl">
          Avances versées par ce revendeur pour un sourcing dédié — chaque mission sert d'enveloppe budgétaire dans laquelle les pièces trouvées sont affectées au fur et à mesure.
        </p>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors text-sm flex-shrink-0"
        >
          <Plus className="h-4 w-4" />
          Nouvelle avance / Mission
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center space-x-2">
          <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="h-24 bg-gray-100 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : missions.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <Briefcase className="h-10 w-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">Aucune mission de sourcing pour ce revendeur.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {missions.map((mission) => {
            const consumedRatio = mission.allocated_cost_budget > 0 ? Math.min(mission.consumed_cost_amount / mission.allocated_cost_budget, 1) : 0;
            const overBudget = mission.remaining_cost_budget < 0;
            return (
              <Card key={mission.id} hover onClick={() => setViewingMission(mission)} className="cursor-pointer">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{mission.title}</p>
                      <p className="text-xs text-gray-500">
                        Avance {mission.advance_amount.toFixed(2)} € · {mission.items_count} pièce{mission.items_count > 1 ? 's' : ''} sourcée{mission.items_count > 1 ? 's' : ''}
                        {mission.paid_at && <> · Payée le {new Date(mission.paid_at).toLocaleDateString('fr-FR')}</>}
                      </p>
                    </div>
                    {missionStatusBadge(mission.status)}
                  </div>
                  <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden mb-1.5">
                    <div
                      className={`h-full rounded-full ${overBudget ? 'bg-red-500' : consumedRatio >= 1 ? 'bg-amber-500' : 'bg-gray-900'}`}
                      style={{ width: `${consumedRatio * 100}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <span>{mission.consumed_cost_amount.toFixed(2)} € / {mission.allocated_cost_budget.toFixed(2)} € sourcés</span>
                    <span className={overBudget ? 'text-red-600 font-medium' : mission.gross_margin < 0 ? 'text-red-600 font-medium' : ''}>
                      Marge {mission.gross_margin.toFixed(2)} €
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <CreateSourcingMissionModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSubmit={createMission}
        fixedReseller={{ id: resellerId, company_name: resellerName }}
      />

      <SourcingMissionDetailModal
        mission={viewingMission}
        onClose={() => setViewingMission(null)}
        onStatusChange={async (status) => {
          if (!viewingMission) return { success: false, error: 'Mission inconnue' };
          return setMissionStatus(viewingMission.id, status);
        }}
        onUpdateMission={async (input) => {
          if (!viewingMission) return { success: false, error: 'Mission inconnue' };
          return updateMission(viewingMission.id, input);
        }}
        onItemsChanged={refresh}
      />
    </div>
  );
};

export default SourcingMissionsTab;
