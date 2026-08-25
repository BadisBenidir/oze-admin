import React from 'react';
import { X, MapPin, Package, User, Phone, Truck, FileDown, ExternalLink } from 'lucide-react';
import { AdminShipment, AdminShipmentItem } from '../../../hooks/useAdminShipments';
import { ParcelSplitEditor } from './ParcelSplitEditor';

interface ShipmentDetailModalProps {
  shipment: AdminShipment | null;
  onClose: () => void;
  onGenerated: () => void;
}

const itemRef = (item: AdminShipmentItem) =>
  item.product?.b2b_reference || item.product?.reference || item.product?.product_code || '—';

const ShippedItemRow: React.FC<{ item: AdminShipmentItem }> = ({ item }) => {
  const product = item.product;
  const image = product?.images?.[product.main_image_index] || product?.images?.[0];
  return (
    <div className="flex items-start gap-3 py-2 border-b border-gray-50 last:border-b-0">
      {image ? (
        <img src={image} alt={product?.name || 'Article'} className="h-10 w-10 rounded-lg object-cover flex-shrink-0 border border-gray-100" />
      ) : (
        <div className="h-10 w-10 rounded-lg bg-gray-100 flex-shrink-0" />
      )}
      <div className="min-w-0">
        <p className="text-sm text-gray-900 font-medium truncate">{product?.name || 'Article'}</p>
        <p className="text-xs text-gray-500">
          {product?.brand?.name && <span>{product.brand.name} · </span>}
          Réf. {itemRef(item)}
        </p>
      </div>
    </div>
  );
};

export const ShipmentDetailModal: React.FC<ShipmentDetailModalProps> = ({ shipment, onClose, onGenerated }) => {
  if (!shipment) return null;

  const pp = (shipment.parcel_point || {}) as Record<string, string>;
  const shippedParcels = shipment.parcels.filter((p) => p.status === 'shipped');

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="fixed inset-0 bg-black bg-opacity-25" onClick={onClose} />

        <div className="relative bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-start justify-between p-6 border-b border-gray-100">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">{shipment.requester.fullName}</h3>
              <p className="text-sm text-gray-500 mt-1">
                {shipment.companyName} — demandé le {new Date(shipment.requested_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}
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
                  <>
                    <p className="font-medium flex items-center gap-1.5">
                      <User className="h-3.5 w-3.5 text-gray-400" /> {shipment.requester.fullName}
                    </p>
                    {shipment.requester.address && <p>{shipment.requester.address}</p>}
                    <p>{shipment.requester.postalCode} {shipment.requester.city}</p>
                    {shipment.requester.country && <p>{shipment.requester.country}</p>}
                    {shipment.requester.phone && (
                      <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                        <Phone className="h-3 w-3" /> {shipment.requester.phone}
                      </p>
                    )}
                  </>
                )}
                {shipment.delivery_instructions && (
                  <p className="text-xs text-gray-500 mt-1 italic">{shipment.delivery_instructions}</p>
                )}
              </div>
            </div>

            {shipment.pendingItems.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                  <Package className="h-3.5 w-3.5" /> {shipment.pendingItems.length} article{shipment.pendingItems.length > 1 ? 's' : ''} en attente
                </p>
                <ParcelSplitEditor shipmentId={shipment.id} items={shipment.pendingItems} onGenerated={onGenerated} />
              </div>
            )}

            {shipment.shippedItems.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                  <Truck className="h-3.5 w-3.5" /> {shipment.shippedItems.length} article{shipment.shippedItems.length > 1 ? 's' : ''} expédié{shipment.shippedItems.length > 1 ? 's' : ''}
                </p>
                <div className="border border-gray-100 rounded-lg px-3 mb-3">
                  {shipment.shippedItems.map((item) => <ShippedItemRow key={item.id} item={item} />)}
                </div>
                <div className="space-y-2">
                  {shippedParcels.map((p) => (
                    <div key={p.id} className="rounded-lg p-3 border bg-green-50 border-green-200">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-green-800">Colis {p.parcel_index}</p>
                        {p.label_url && (
                          <a href={p.label_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-green-700 underline hover:text-green-900">
                            <FileDown className="h-3.5 w-3.5" /> Réimprimer l'étiquette
                          </a>
                        )}
                      </div>
                      {p.tracking_number && (
                        <p className="text-xs text-green-700 mt-1">
                          Suivi : {p.tracking_number}{' '}
                          {p.tracking_url && (
                            <a href={p.tracking_url} target="_blank" rel="noopener noreferrer" className="underline inline-flex items-center gap-0.5">
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ShipmentDetailModal;
