import React, { useState } from 'react';
import { X, AlertCircle } from 'lucide-react';
import { AdminShipment } from '../../../hooks/useAdminShipments';
import { invokeEdgeFunction } from '../../../utils/invokeEdgeFunction';

const DEFAULT_REASON = 'Erreur de pointage logistique : articles encore en transit';

type RefundMethod = 'wallet' | 'stripe' | 'none';

export interface CancelDeliveryRequestResult {
  success: boolean;
  error?: string;
  item_count?: number;
  refund_status?: 'not_applicable' | 'succeeded' | 'failed';
  refunded_amount?: number;
  refund_error?: string;
}

interface CancelDeliveryRequestModalProps {
  shipment: AdminShipment;
  onClose: () => void;
  onCancelled: (result: CancelDeliveryRequestResult) => void;
}

/** Annulation admin d'une demande de livraison pas encore étiquetée — aucun
 * appel Sendcloud (Edge Function cancel-delivery-request, voir 0159) : les
 * articles repassent "en acheminement vers l'atelier" et le revendeur est
 * notifié dans son espace pro. */
export const CancelDeliveryRequestModal: React.FC<CancelDeliveryRequestModalProps> = ({ shipment, onClose, onCancelled }) => {
  const hasFee = shipment.shipping_cost > 0;
  const [reason, setReason] = useState(DEFAULT_REASON);
  const [refundMethod, setRefundMethod] = useState<RefundMethod>(hasFee ? (shipment.has_stripe_payment ? 'stripe' : 'wallet') : 'none');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleConfirm = async () => {
    if (!reason.trim()) {
      setError('Le motif est requis');
      return;
    }
    setSubmitting(true);
    setError('');
    const { data, error: fnError } = await invokeEdgeFunction<CancelDeliveryRequestResult>('cancel-delivery-request', {
      shipment_id: shipment.id,
      reason: reason.trim(),
      refund_method: hasFee ? refundMethod : 'none',
    });
    setSubmitting(false);
    if (fnError) {
      setError(fnError);
      return;
    }
    onCancelled({ success: true, ...(data || {}) });
  };

  const radio = 'h-4 w-4 text-gray-900 focus:ring-gray-900 mt-0.5';
  const fee = shipment.shipping_cost.toFixed(2).replace('.', ',') + ' €';

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto">
      <div className="fixed inset-0 bg-black bg-opacity-50" onClick={onClose} />
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between p-5 border-b border-gray-100">
            <h3 className="text-base font-semibold text-gray-900">Annuler la demande de livraison</h3>
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded-lg transition-colors">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="p-5 space-y-4">
            <p className="text-sm text-gray-600">
              Les {shipment.pendingItems.length} article{shipment.pendingItems.length > 1 ? 's' : ''} de {shipment.requester.fullName} repasseront
              {' '}« en acheminement vers l'atelier » (à réceptionner). Aucun appel Sendcloud. Le revendeur sera prévenu dans son espace pro, puis de nouveau dès que ses articles seront pointés prêts.
            </p>

            <div>
              <label htmlFor="cancel-delivery-reason" className="block text-sm font-medium text-gray-700 mb-2">Motif</label>
              <textarea
                id="cancel-delivery-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-gray-400 text-sm"
              />
              <p className="text-xs text-gray-400 mt-1">Un motif différent du motif par défaut est affiché au revendeur.</p>
            </div>

            {hasFee && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Frais de port payés : {fee}</label>
                <div className="space-y-2">
                  <label className={`flex items-start gap-2 text-sm ${shipment.has_stripe_payment ? 'text-gray-700' : 'text-gray-400'}`}>
                    <input type="radio" name="delivery-refund" checked={refundMethod === 'stripe'} onChange={() => setRefundMethod('stripe')} disabled={!shipment.has_stripe_payment} className={radio} />
                    Rembourser sur la carte (Stripe)
                  </label>
                  <label className="flex items-start gap-2 text-sm text-gray-700">
                    <input type="radio" name="delivery-refund" checked={refundMethod === 'wallet'} onChange={() => setRefundMethod('wallet')} className={radio} />
                    Créditer le solde du revendeur
                  </label>
                  <label className="flex items-start gap-2 text-sm text-gray-700">
                    <input type="radio" name="delivery-refund" checked={refundMethod === 'none'} onChange={() => setRefundMethod('none')} className={radio} />
                    Ne pas rembourser
                  </label>
                </div>
              </div>
            )}

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center space-x-2">
                <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3 p-5 pt-0">
            <button onClick={onClose} disabled={submitting} className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors text-sm disabled:opacity-50">
              Retour
            </button>
            <button
              onClick={handleConfirm}
              disabled={submitting}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm font-medium disabled:opacity-50"
            >
              {submitting ? 'Annulation...' : 'Annuler la demande'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CancelDeliveryRequestModal;
