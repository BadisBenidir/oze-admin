import React, { useEffect, useState } from 'react';
import { Card, CardContent } from '../../ui/Card';
import { Badge } from '../../ui/Badge';
import { useAdminAuth } from '../../../hooks/useAdminAuth';
import { useAdminShipments, AdminShipment } from '../../../hooks/useAdminShipments';
import { useSendcloudSync } from '../../../hooks/useSendcloudSync';
import { ShipmentDetailModal } from './ShipmentDetailModal';
import { AlertCircle, Truck, Eye, CheckCircle, RefreshCw } from 'lucide-react';

const statusBadge = (status: AdminShipment['status']) => {
  if (status === 'preparing') return <Badge variant="warning">En préparation</Badge>;
  if (status === 'in_transit') return <Badge variant="info">Expédié / En transit</Badge>;
  if (status === 'delivered') return <Badge variant="success">Livré</Badge>;
  return <Badge variant="info">Livraison demandée</Badge>;
};

type Tab = 'pending' | 'shipped';

export const ShipmentRequestsView: React.FC = () => {
  const { isAdmin } = useAdminAuth();
  const [tab, setTab] = useState<Tab>('pending');
  const pendingData = useAdminShipments(isAdmin, ['requested', 'preparing']);
  const shippedData = useAdminShipments(isAdmin, ['in_transit', 'delivered']);
  const { shipments, loading, error } = tab === 'pending' ? pendingData : shippedData;
  const { sync: syncSendcloud } = useSendcloudSync();
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncProgress, setSyncProgress] = useState<{ checked: number; updated: number } | null>(null);

  const handleSyncAll = async () => {
    setSyncError(null);
    setSyncProgress(null);
    setSyncing(true);
    // Sans shipmentId : balaie tout l'arriéré, en plusieurs appels internes
    // tant que le serveur signale qu'il en reste (voir useSendcloudSync) —
    // reste un seul clic côté admin même sur un gros arriéré.
    const result = await syncSendcloud(undefined, setSyncProgress);
    setSyncing(false);
    pendingData.refresh();
    shippedData.refresh();
    if (!result.success) {
      setSyncError(result.error || 'Impossible de contacter Sendcloud');
      return;
    }
    if (result.incomplete) {
      setSyncError(`Arriéré important : ${result.checked} colis vérifiés (${result.updated} mis à jour), relance encore pour continuer.`);
    }
  };

  const [viewingId, setViewingId] = useState<string | null>(null);
  // Snapshot indépendant de la liste filtrée par onglet : dès qu'un shipment
  // passe entièrement à 'shipped' (génération du dernier colis), il sort de
  // la liste "en attente" — sans ce snapshot, la modale se refermerait
  // brutalement en pleine confirmation de succès (bug signalé : la demande
  // "disparaît" et devient introuvable). On garde la dernière version connue
  // affichée, et on la met à jour dès qu'une donnée plus fraîche est dispo
  // (dans l'un ou l'autre onglet).
  const [viewingSnapshot, setViewingSnapshot] = useState<AdminShipment | null>(null);

  useEffect(() => {
    if (!viewingId) return;
    const fresh = pendingData.shipments.find((s) => s.id === viewingId) || shippedData.shipments.find((s) => s.id === viewingId);
    if (fresh) setViewingSnapshot(fresh);
  }, [pendingData.shipments, shippedData.shipments, viewingId]);

  const openShipment = (shipment: AdminShipment) => {
    setViewingId(shipment.id);
    setViewingSnapshot(shipment);
  };
  const closeShipment = () => {
    setViewingId(null);
    setViewingSnapshot(null);
  };

  const handleGenerated = () => {
    // Une génération peut faire passer le shipment en 'shipped' : il quitte
    // la file "en attente" et doit apparaître dans l'historique — on
    // rafraîchit les deux listes, jamais seulement celle de l'onglet actif.
    pendingData.refresh();
    shippedData.refresh();
  };

  return (
    <div className="p-4 md:p-6">
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Demandes de livraison</h3>
          <p className="text-sm text-gray-500">{loading ? 'Chargement...' : `${shipments.length} demande${shipments.length > 1 ? 's' : ''}`}</p>
        </div>
        <button
          onClick={handleSyncAll}
          disabled={syncing}
          title="Interroge Sendcloud pour rafraîchir le statut réel de tous les colis en cours"
          className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
          {syncing
            ? syncProgress
              ? `Actualisation... (${syncProgress.checked} vérifiés)`
              : 'Actualisation...'
            : 'Actualiser les statuts Sendcloud'}
        </button>
      </div>

      {syncError && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-3">
          <p className="text-sm text-amber-800">{syncError}</p>
        </div>
      )}

      <div className="mb-4 flex items-center gap-1 border-b border-gray-100">
        <button
          onClick={() => setTab('pending')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            tab === 'pending' ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          En attente d'expédition
        </button>
        <button
          onClick={() => setTab('shipped')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            tab === 'shipped' ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Expédiées / Bordereaux générés
        </button>
      </div>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-center space-x-3">
          <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
          <p className="text-sm text-red-700">Erreur : {error}</p>
        </div>
      )}

      {!loading && !error && shipments.length === 0 && (
        <div className="text-center py-16 border border-dashed border-gray-200 rounded-lg">
          {tab === 'pending' ? (
            <>
              <Truck className="h-10 w-10 text-gray-300 mx-auto mb-3" />
              <p className="text-sm text-gray-500">Aucune demande de livraison en attente.</p>
            </>
          ) : (
            <>
              <CheckCircle className="h-10 w-10 text-gray-300 mx-auto mb-3" />
              <p className="text-sm text-gray-500">Aucune expédition dans l'historique pour le moment.</p>
            </>
          )}
        </div>
      )}

      {(shipments.length > 0 || loading) && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-3 px-4 md:px-6 font-medium text-gray-900 text-sm">Demandeur</th>
                    <th className="text-left py-3 px-4 md:px-6 font-medium text-gray-900 text-sm">Demandée le</th>
                    <th className="text-left py-3 px-4 md:px-6 font-medium text-gray-900 text-sm hidden md:table-cell">Articles</th>
                    <th className="text-left py-3 px-4 md:px-6 font-medium text-gray-900 text-sm">Statut</th>
                    <th className="text-left py-3 px-4 md:px-6 font-medium text-gray-900 text-sm">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    [...Array(3)].map((_, i) => (
                      <tr key={`skeleton-${i}`} className="border-b border-gray-50">
                        <td className="py-4 px-4 md:px-6" colSpan={5}>
                          <div className="h-4 w-full bg-gray-100 rounded animate-pulse" />
                        </td>
                      </tr>
                    ))
                  ) : (
                    shipments.map((shipment) => {
                      const articleCount = tab === 'pending' ? shipment.pendingItems.length : shipment.shippedItems.length;
                      return (
                        <tr key={shipment.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                          <td className="py-4 px-4 md:px-6 text-sm">
                            <p className="text-gray-900 font-medium">{shipment.requester.fullName}</p>
                            <p className="text-xs text-gray-500">{shipment.companyName}</p>
                          </td>
                          <td className="py-4 px-4 md:px-6 text-sm text-gray-600">{new Date(shipment.requested_at).toLocaleDateString('fr-FR')}</td>
                          <td className="py-4 px-4 md:px-6 hidden md:table-cell text-sm text-gray-600">
                            {articleCount} pièce{articleCount > 1 ? 's' : ''}
                          </td>
                          <td className="py-4 px-4 md:px-6">{statusBadge(shipment.status)}</td>
                          <td className="py-4 px-4 md:px-6">
                            <button
                              onClick={() => openShipment(shipment)}
                              className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                              title={tab === 'pending' ? 'Traiter la demande' : 'Voir le détail'}
                            >
                              <Eye className="h-4 w-4" />
                            </button>
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

      <ShipmentDetailModal shipment={viewingSnapshot} onClose={closeShipment} onGenerated={handleGenerated} />
    </div>
  );
};

export default ShipmentRequestsView;
