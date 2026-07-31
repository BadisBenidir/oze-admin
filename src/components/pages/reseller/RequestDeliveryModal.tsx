import React, { useState } from 'react';
import { X, Truck, AlertCircle } from 'lucide-react';
import ShippingForm, { ShippingSelection } from './ShippingForm';
import { useResellerAuth } from '../../../hooks/useResellerAuth';
import { DeliveryBatch } from '../../../hooks/useDeliveryBatches';

interface RequestDeliveryModalProps {
  batch: DeliveryBatch;
  orderCount: number;
  onClose: () => void;
  onSubmit: (deliveryType: ShippingSelection['deliveryType'], parcelPoint: ShippingSelection['parcelPoint'], instructions: string | null) => Promise<{ success: boolean; error?: string }>;
}

/**
 * Le mode/l'adresse de livraison ne sont plus choisis au checkout (voir
 * CartPage) : c'est ici, une seule fois par lot plutôt qu'une fois par
 * commande, que le revendeur les choisit — au moment où il demande
 * effectivement la livraison de tout ce qui n'a pas encore été expédié.
 */
export const RequestDeliveryModal: React.FC<RequestDeliveryModalProps> = ({ batch, orderCount, onClose, onSubmit }) => {
  const { profile } = useResellerAuth();
  const hasAddress = Boolean(profile?.address && profile?.city && profile?.postal_code);

  const [shipping, setShipping] = useState<ShippingSelection>({
    deliveryType: hasAddress ? 'domicile' : 'point_relais',
    parcelPoint: null,
  });
  const [instructions, setInstructions] = useState(profile?.delivery_instructions || '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (shipping.deliveryType === 'domicile' && !hasAddress) return;
    if (shipping.deliveryType === 'point_relais' && !shipping.parcelPoint) {
      setError('Veuillez sélectionner un point relais avant de confirmer.');
      return;
    }
    setError(null);
    setSubmitting(true);
    const result = await onSubmit(shipping.deliveryType, shipping.parcelPoint, instructions || null);
    setSubmitting(false);
    if (!result.success) {
      setError(result.error || 'Une erreur est survenue');
      return;
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="fixed inset-0 bg-black bg-opacity-25" onClick={onClose} />

        <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-start justify-between p-6 border-b border-gray-100">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Demander la livraison</h3>
              <p className="text-sm text-gray-500 mt-1">
                Lot du {new Date(batch.created_at).toLocaleDateString('fr-FR')} — {orderCount} commande{orderCount > 1 ? 's' : ''} en attente de livraison
              </p>
            </div>
            <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg transition-colors">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="p-6 space-y-4">
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            <ShippingForm
              companyAddress={{
                address: profile?.address || '',
                city: profile?.city || '',
                postalCode: profile?.postal_code || '',
                country: profile?.country || 'France',
              }}
              value={shipping}
              onChange={setShipping}
            />

            {shipping.deliveryType === 'domicile' && (
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Consignes de livraison (optionnel)</label>
                <textarea
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-400"
                  placeholder="Étage, digicode, horaires..."
                />
              </div>
            )}

            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="w-full flex items-center justify-center space-x-2 px-4 py-2.5 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
            >
              <Truck className="h-4 w-4" />
              <span>{submitting ? 'Envoi de la demande...' : 'Confirmer la demande de livraison'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RequestDeliveryModal;
