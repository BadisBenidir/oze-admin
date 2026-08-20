import React, { useEffect, useState } from 'react';
import { Card, CardContent } from '../../ui/Card';
import { Badge } from '../../ui/Badge';
import { useAdminAuth } from '../../../hooks/useAdminAuth';
import { useAdminShipments, AdminShipment } from '../../../hooks/useAdminShipments';
import { ShipmentDetailModal } from './ShipmentDetailModal';
import { AlertCircle, Truck, Eye } from 'lucide-react';

const statusBadge = (status: AdminShipment['status']) => {
  if (status === 'partially_shipped') return <Badge variant="warning">Partiellement expédié</Badge>;
  return <Badge variant="info">Livraison demandée</Badge>;
};

export const ShipmentRequestsView: React.FC = () => {
  const { isAdmin } = useAdminAuth();
  const { shipments, loading, error, refresh } = useAdminShipments(isAdmin);
  const [viewingId, setViewingId] = useState<string | null>(null);

  const viewing = shipments.find((s) => s.id === viewingId) || null;

  // Une fois le shipment entièrement expédié, il disparaît de la liste
  // (refresh) — referme donc la modal si elle pointait dessus.
  useEffect(() => {
    if (viewingId && !shipments.some((s) => s.id === viewingId)) {
      setViewingId(null);
    }
  }, [shipments, viewingId]);

  return (
    <div className="p-4 md:p-6">
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-gray-900">Demandes de livraison</h3>
        <p className="text-sm text-gray-500">{loading ? 'Chargement...' : `${shipments.length} demande${shipments.length > 1 ? 's' : ''}`}</p>
      </div>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-center space-x-3">
          <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
          <p className="text-sm text-red-700">Erreur : {error}</p>
        </div>
      )}

      {!loading && !error && shipments.length === 0 && (
        <div className="text-center py-16 border border-dashed border-gray-200 rounded-lg">
          <Truck className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500">Aucune demande de livraison en attente.</p>
        </div>
      )}

      {(shipments.length > 0 || loading) && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-3 px-4 md:px-6 font-medium text-gray-900 text-sm">Revendeur</th>
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
                    shipments.map((shipment) => (
                      <tr key={shipment.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                        <td className="py-4 px-4 md:px-6 text-sm text-gray-900 font-medium">{shipment.companyName}</td>
                        <td className="py-4 px-4 md:px-6 text-sm text-gray-600">{new Date(shipment.requested_at).toLocaleDateString('fr-FR')}</td>
                        <td className="py-4 px-4 md:px-6 hidden md:table-cell text-sm text-gray-600">
                          {shipment.pendingItems.length} pièce{shipment.pendingItems.length > 1 ? 's' : ''}
                        </td>
                        <td className="py-4 px-4 md:px-6">{statusBadge(shipment.status)}</td>
                        <td className="py-4 px-4 md:px-6">
                          <button
                            onClick={() => setViewingId(shipment.id)}
                            className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            title="Traiter la demande"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
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

      <ShipmentDetailModal shipment={viewing} onClose={() => setViewingId(null)} onGenerated={refresh} />
    </div>
  );
};

export default ShipmentRequestsView;
