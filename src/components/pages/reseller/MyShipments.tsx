import React from 'react';
import { Card, CardContent } from '../../ui/Card';
import { Badge } from '../../ui/Badge';
import { useResellerAuth } from '../../../hooks/useResellerAuth';
import { useMyShipments, MyShipment } from '../../../hooks/useMyShipments';
import { AlertCircle, Truck, MapPin, FileDown, ExternalLink } from 'lucide-react';

const statusBadge = (status: MyShipment['status']) => {
  switch (status) {
    case 'shipped':
      return <Badge variant="success">Expédié</Badge>;
    case 'partially_shipped':
      return <Badge variant="warning">Partiellement expédié</Badge>;
    default:
      return <Badge variant="info">En préparation</Badge>;
  }
};

const parcelStatusBadge = (status: string) => {
  if (status === 'shipped') return <Badge variant="success">Expédié</Badge>;
  if (status === 'failed') return <Badge variant="danger">Échec</Badge>;
  return <Badge variant="warning">En attente</Badge>;
};

export const MyShipments: React.FC = () => {
  const { isReseller } = useResellerAuth();
  const { shipments, loading, error } = useMyShipments(isReseller);

  return (
    <div className="p-4 md:p-6">
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-gray-900">Suivi livraisons</h3>
        <p className="text-sm text-gray-500">{loading ? 'Chargement...' : `${shipments.length} expédition${shipments.length > 1 ? 's' : ''}`}</p>
      </div>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-center space-x-3">
          <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
          <p className="text-sm text-red-700">Erreur : {error}</p>
        </div>
      )}

      {loading && (
        <div className="space-y-4">
          {[...Array(2)].map((_, i) => <div key={i} className="h-28 bg-gray-100 rounded-lg animate-pulse" />)}
        </div>
      )}

      {!loading && !error && shipments.length === 0 && (
        <div className="text-center py-16 border border-dashed border-gray-200 rounded-lg">
          <Truck className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500">Aucune demande de livraison pour l'instant.</p>
        </div>
      )}

      <div className="space-y-4">
        {shipments.map((shipment) => {
          const pp = (shipment.parcel_point || {}) as Record<string, string>;
          return (
            <Card key={shipment.id}>
              <CardContent className="p-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      Demandée le {new Date(shipment.requested_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}
                    </p>
                    <p className="text-xs text-gray-500">{shipment.itemCount} article{shipment.itemCount > 1 ? 's' : ''} — {shipment.shipping_cost.toFixed(2)} € de frais de port</p>
                  </div>
                  {statusBadge(shipment.status)}
                </div>

                <div className="bg-gray-50 rounded-lg p-3 flex items-start gap-2 mb-3">
                  <MapPin className="h-4 w-4 text-gray-400 flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-gray-900">
                    {shipment.delivery_type === 'point_relais' ? (
                      <>
                        <p className="font-medium">{pp.name || 'Point Relais'}</p>
                        {pp.address && <p>{pp.address}</p>}
                        <p>{pp.zipCode} {pp.city}</p>
                      </>
                    ) : (
                      <p>Livraison à l'adresse de l'entreprise</p>
                    )}
                    {shipment.delivery_instructions && (
                      <p className="text-xs text-gray-500 mt-1 italic">{shipment.delivery_instructions}</p>
                    )}
                  </div>
                </div>

                {shipment.parcels.length === 0 ? (
                  <p className="text-xs text-gray-400">Aucun colis généré pour l'instant.</p>
                ) : (
                  <div className="space-y-2">
                    {shipment.parcels.map((parcel) => (
                      <div key={parcel.id} className="bg-white border border-gray-100 rounded-lg px-3 py-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-gray-700">Colis {parcel.parcel_index}</span>
                            {parcelStatusBadge(parcel.status)}
                          </div>
                          <div className="flex items-center gap-3">
                            {parcel.tracking_number && (
                              <span className="text-xs text-gray-500">
                                {parcel.tracking_number}
                                {parcel.tracking_url && (
                                  <a href={parcel.tracking_url} target="_blank" rel="noopener noreferrer" className="ml-1 text-blue-600 underline inline-flex items-center gap-0.5">
                                    suivre <ExternalLink className="h-3 w-3" />
                                  </a>
                                )}
                              </span>
                            )}
                            {parcel.label_url && (
                              <a href={parcel.label_url} target="_blank" rel="noopener noreferrer" className="text-xs text-gray-600 underline inline-flex items-center gap-1">
                                <FileDown className="h-3 w-3" /> Étiquette
                              </a>
                            )}
                          </div>
                        </div>
                        {parcel.itemNames.length > 0 && (
                          <p className="text-xs text-gray-400 mt-1.5">
                            Contenu : {parcel.itemNames.join(', ')}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
};

export default MyShipments;
