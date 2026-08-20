import React from 'react';
import { X, MapPin, Package } from 'lucide-react';
import { AdminShipment } from '../../../hooks/useAdminShipments';
import { ParcelSplitEditor } from './ParcelSplitEditor';

interface ShipmentDetailModalProps {
  shipment: AdminShipment | null;
  onClose: () => void;
  onGenerated: () => void;
}

export const ShipmentDetailModal: React.FC<ShipmentDetailModalProps> = ({ shipment, onClose, onGenerated }) => {
  if (!shipment) return null;

  const pp = (shipment.parcel_point || {}) as Record<string, string>;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="fixed inset-0 bg-black bg-opacity-25" onClick={onClose} />

        <div className="relative bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-start justify-between p-6 border-b border-gray-100">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">{shipment.companyName}</h3>
              <p className="text-sm text-gray-500 mt-1">
                Demandé le {new Date(shipment.requested_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}
              </p>
            </div>
            <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg transition-colors">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="p-6 space-y-6">
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 flex items-start gap-2">
              <MapPin className="h-4 w-4 text-gray-400 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-gray-900">
                {shipment.delivery_type === 'point_relais' ? (
                  <>
                    <p className="font-medium">{pp.name || 'Point Relais'}</p>
                    {pp.address && <p>{pp.address}</p>}
                    <p>{pp.zipCode} {pp.city}</p>
                    {pp.network && <p className="text-xs text-gray-500 mt-1">{pp.network}</p>}
                  </>
                ) : (
                  <p>Livraison à l'adresse enregistrée du revendeur</p>
                )}
                {shipment.delivery_instructions && (
                  <p className="text-xs text-gray-500 mt-1 italic">{shipment.delivery_instructions}</p>
                )}
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <Package className="h-3.5 w-3.5" /> {shipment.pendingItems.length} article{shipment.pendingItems.length > 1 ? 's' : ''} en attente
              </p>
              <ParcelSplitEditor shipmentId={shipment.id} items={shipment.pendingItems} onGenerated={onGenerated} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ShipmentDetailModal;
