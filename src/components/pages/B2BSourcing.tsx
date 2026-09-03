import React, { useMemo, useState } from 'react';
import { Plus, Briefcase, AlertCircle, Banknote, PieChart, Wallet } from 'lucide-react';
import { Card, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { useAdminAuth } from '../../hooks/useAdminAuth';
import { useSourcingMissions, SourcingMission } from '../../hooks/useSourcingMissions';
import { CreateSourcingMissionModal } from './b2b/CreateSourcingMissionModal';
import { SourcingMissionDetailModal } from './b2b/SourcingMissionDetailModal';

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

const requesterLabel = (mission: SourcingMission): string => {
  if (!mission.requester) return '—';
  const fullName = `${mission.requester.first_name || ''} ${mission.requester.last_name || ''}`.trim();
  return fullName || mission.requester.email || '—';
};

/** Vue globale de toutes les missions de sourcing sur mesure, toutes
 * entreprises confondues — voir aussi SourcingMissionsTab.tsx pour l'accès
 * contextuel depuis la fiche d'un revendeur précis. */
export const B2BSourcing: React.FC = () => {
  const { isAdmin } = useAdminAuth();
  const { missions, loading, error, refresh, createMission, setMissionStatus } = useSourcingMissions(undefined, isAdmin);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [viewingMission, setViewingMission] = useState<SourcingMission | null>(null);
  const [resellerFilter, setResellerFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | SourcingMission['status']>('all');

  const resellerOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const m of missions) byId.set(m.reseller_id, m.company_name);
    return Array.from(byId.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [missions]);

  const filteredMissions = useMemo(() => {
    return missions.filter((m) => {
      if (resellerFilter !== 'all' && m.reseller_id !== resellerFilter) return false;
      if (statusFilter !== 'all' && m.status !== statusFilter) return false;
      return true;
    });
  }, [missions, resellerFilter, statusFilter]);

  // Totaux hors missions annulées — jamais réellement disponibles à consommer.
  const activeMissions = missions.filter((m) => m.status !== 'cancelled');
  const totalBudget = activeMissions.reduce((sum, m) => sum + m.budget_amount, 0);
  const totalConsumed = activeMissions.reduce((sum, m) => sum + m.consumed_amount, 0);
  const totalRemaining = activeMissions.reduce((sum, m) => sum + m.remaining_amount, 0);

  return (
    <div className="p-4 md:p-6">
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Sourcing sur mesure</h3>
          <p className="text-sm text-gray-500">Avances versées par les revendeurs pour un sourcing dédié, toutes entreprises confondues</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors text-sm flex-shrink-0"
        >
          <Plus className="h-4 w-4" />
          Nouvelle avance / Mission
        </button>
      </div>

      {!loading && !error && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <Banknote className="h-4 w-4 text-gray-400" />
                <p className="text-xs text-gray-500">Total budgets avancés</p>
              </div>
              <p className="text-xl font-semibold text-gray-900">{totalBudget.toFixed(2)} €</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <PieChart className="h-4 w-4 text-gray-400" />
                <p className="text-xs text-gray-500">Total consommé</p>
              </div>
              <p className="text-xl font-semibold text-gray-900">{totalConsumed.toFixed(2)} €</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <Wallet className="h-4 w-4 text-gray-400" />
                <p className="text-xs text-gray-500">Reste à sourcer</p>
              </div>
              <p className="text-xl font-semibold text-gray-900">{totalRemaining.toFixed(2)} €</p>
            </CardContent>
          </Card>
        </div>
      )}

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-center space-x-3">
          <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
          <p className="text-sm text-red-700">Erreur : {error}</p>
        </div>
      )}

      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <select
          value={resellerFilter}
          onChange={(e) => setResellerFilter(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-400 bg-white"
        >
          <option value="all">Tous les revendeurs</option>
          {resellerOptions.map(([id, name]) => (
            <option key={id} value={id}>{name}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as 'all' | SourcingMission['status'])}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-400 bg-white"
        >
          <option value="all">Tous les statuts</option>
          <option value="active">Active</option>
          <option value="completed">Terminée</option>
          <option value="cancelled">Annulée</option>
        </select>
      </div>

      {!loading && !error && missions.length === 0 ? (
        <div className="text-center py-12">
          <Briefcase className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Aucune mission de sourcing</h3>
          <p className="text-gray-500">Les missions créées depuis une fiche revendeur ou ce panneau apparaîtront ici.</p>
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-3 px-4 md:px-6 font-medium text-gray-900 text-sm">Mission</th>
                    <th className="text-left py-3 px-4 md:px-6 font-medium text-gray-900 text-sm">Entreprise</th>
                    <th className="text-left py-3 px-4 md:px-6 font-medium text-gray-900 text-sm hidden lg:table-cell">Demandeur</th>
                    <th className="text-right py-3 px-4 md:px-6 font-medium text-gray-900 text-sm">Budget</th>
                    <th className="text-right py-3 px-4 md:px-6 font-medium text-gray-900 text-sm">Consommé</th>
                    <th className="text-right py-3 px-4 md:px-6 font-medium text-gray-900 text-sm">Reste</th>
                    <th className="text-left py-3 px-4 md:px-6 font-medium text-gray-900 text-sm">Statut</th>
                    <th className="text-left py-3 px-4 md:px-6 font-medium text-gray-900 text-sm hidden md:table-cell">Avance</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    [...Array(3)].map((_, i) => (
                      <tr key={`skeleton-${i}`} className="border-b border-gray-50">
                        <td className="py-4 px-4 md:px-6" colSpan={8}>
                          <div className="h-4 w-full bg-gray-100 rounded animate-pulse" />
                        </td>
                      </tr>
                    ))
                  ) : filteredMissions.length === 0 ? (
                    <tr>
                      <td className="py-8 px-4 md:px-6 text-center text-sm text-gray-500" colSpan={8}>
                        Aucune mission ne correspond à ces filtres.
                      </td>
                    </tr>
                  ) : (
                    filteredMissions.map((mission) => {
                      const overBudget = mission.remaining_amount < 0;
                      return (
                        <tr
                          key={mission.id}
                          onClick={() => setViewingMission(mission)}
                          className="border-b border-gray-50 hover:bg-gray-50 transition-colors cursor-pointer"
                        >
                          <td className="py-3 px-4 md:px-6 text-sm font-medium text-gray-900">{mission.title}</td>
                          <td className="py-3 px-4 md:px-6 text-sm text-gray-600">{mission.company_name}</td>
                          <td className="py-3 px-4 md:px-6 hidden lg:table-cell text-sm text-gray-600">
                            {mission.requester ? (
                              <>
                                <p>{requesterLabel(mission)}</p>
                                {mission.requester.email && <p className="text-xs text-gray-400">{mission.requester.email}</p>}
                              </>
                            ) : '—'}
                          </td>
                          <td className="py-3 px-4 md:px-6 text-right text-sm text-gray-900 tabular-nums">{mission.budget_amount.toFixed(2)} €</td>
                          <td className="py-3 px-4 md:px-6 text-right text-sm text-gray-900 tabular-nums">{mission.consumed_amount.toFixed(2)} €</td>
                          <td className={`py-3 px-4 md:px-6 text-right text-sm font-semibold tabular-nums ${overBudget ? 'text-red-600' : 'text-gray-900'}`}>
                            {mission.remaining_amount.toFixed(2)} €
                          </td>
                          <td className="py-3 px-4 md:px-6">{missionStatusBadge(mission.status)}</td>
                          <td className="py-3 px-4 md:px-6 hidden md:table-cell text-sm text-gray-600">
                            {mission.paid_at ? new Date(mission.paid_at).toLocaleDateString('fr-FR') : '—'}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <CreateSourcingMissionModal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} onSubmit={createMission} />

      <SourcingMissionDetailModal
        mission={viewingMission}
        onClose={() => setViewingMission(null)}
        onStatusChange={async (status) => {
          if (!viewingMission) return { success: false, error: 'Mission inconnue' };
          const result = await setMissionStatus(viewingMission.id, status);
          if (result.success) setViewingMission((prev) => (prev ? { ...prev, status } : prev));
          return result;
        }}
        onItemsChanged={refresh}
      />
    </div>
  );
};

export default B2BSourcing;
