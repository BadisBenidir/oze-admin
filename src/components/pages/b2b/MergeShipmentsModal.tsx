import React, { useState } from 'react';
import { X, AlertCircle, AlertTriangle } from 'lucide-react';
import { AdminShipment } from '../../../hooks/useAdminShipments';
import { invokeEdgeFunction } from '../../../utils/invokeEdgeFunction';

export interface MergeShipmentsResult {
  success: boolean;
  error?: string;
  moved_items?: number;
  attached_to_existing_label?: boolean;
  cancelled_labels?: number;
  target_status?: string;
}

interface MergeShipmentsModalProps {
  target: AdminShipment;
  /** Autres demandes actives (en attente / en préparation) du même revendeur. */
  candidates: AdminShipment[];
  onClose: () => void;
  onDone: (result: MergeShipmentsResult) => void;
}

const addressLabel = (s: AdminShipment): string => {
  if (s.delivery_type === 'point_relais') {
    const pp = (s.parcel_point || {}) as Record<string, unknown>;
    return `Point relais ${pp.name || ''} — ${pp.zipCode || ''} ${pp.city || ''}`.trim();
  }
  return `Domicile — ${s.requester.address || ''}, ${s.requester.postalCode || ''} ${s.requester.city || ''}`.trim();
};

const labelCount = (s: AdminShipment) => s.parcels.filter((p) => p.status === 'label_created').length;
const itemCount = (s: AdminShipment) => s.pendingItems.length + s.shippedItems.length;

/** Regroupe une autre demande du même revendeur dans celle-ci (un seul
 * carton) — Edge Function merge-shipments (voir 0163). */
export const MergeShipmentsModal: React.FC<MergeShipmentsModalProps> = ({ target, candidates, onClose, onDone }) => {
  const [sourceId, setSourceId] = useState<string | null>(candidates.length === 1 ? candidates[0].id : null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const source = candidates.find((c) => c.id === sourceId) || null;
  const targetLabels = labelCount(target);
  const differentAddress = source ? addressLabel(source) !== addressLabel(target) : false;

  const handleConfirm = async () => {
    if (!source) return;
    setSubmitting(true);
    setError('');
    const { data, error: fnError } = await invokeEdgeFunction<MergeShipmentsResult>('merge-shipments', {
      target_id: target.id,
      source_id: source.id,
    });
    setSubmitting(false);
    if (fnError) {
      setError(fnError);
      return;
    }
    onDone({ success: true, ...(data || {}) });
  };

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto">
      <div className="fixed inset-0 bg-black bg-opacity-50" onClick={onClose} />
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between p-5 border-b border-gray-100">
            <h3 className="text-base font-semibold text-gray-900">Regrouper dans un seul carton</h3>
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded-lg transition-colors">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="p-5 space-y-4">
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Demande conservée (adresse utilisée)</p>
              <p className="text-gray-900 font-medium">
                {target.requester.fullName} — {new Date(target.requested_at).toLocaleDateString('fr-FR')} · {itemCount(target)} pièce{itemCount(target) > 1 ? 's' : ''}
              </p>
              <p className="text-gray-600 text-xs mt-0.5">{addressLabel(target)}</p>
            </div>

            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">Demande à regrouper dedans</p>
              {candidates.length === 0 ? (
                <p className="text-sm text-gray-500">Aucune autre demande en attente ou en préparation pour ce revendeur.</p>
              ) : (
                <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
                  {candidates.map((c) => (
                    <label key={c.id} className="flex items-start gap-3 p-3 cursor-pointer hover:bg-gray-50">
                      <input type="radio" name="merge-source" checked={sourceId === c.id} onChange={() => setSourceId(c.id)} className="h-4 w-4 mt-0.5 text-gray-900 focus:ring-gray-900" />
                      <div className="min-w-0 text-sm">
                        <p className="text-gray-900 font-medium">
                          {c.requester.fullName} — {new Date(c.requested_at).toLocaleDateString('fr-FR')} · {itemCount(c)} pièce{itemCount(c) > 1 ? 's' : ''}
                        </p>
                        <p className="text-gray-600 text-xs mt-0.5">{addressLabel(c)}</p>
                        {labelCount(c) > 0 && (
                          <p className="text-amber-700 text-xs mt-0.5">
                            {labelCount(c)} bordereau{labelCount(c) > 1 ? 'x' : ''} généré{labelCount(c) > 1 ? 's' : ''} — sera annulé chez Sendcloud
                          </p>
                        )}
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {source && differentAddress && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-amber-800">
                  Adresses différentes : tout partira à l'adresse de la demande conservée ({addressLabel(target)}).
                </p>
              </div>
            )}

            {source && (
              <p className="text-xs text-gray-500">
                {targetLabels === 1
                  ? "La demande conservée a déjà un bordereau : les articles y sont ajoutés, son étiquette est gardée (pensez au poids du carton)."
                  : targetLabels > 1
                    ? "La demande conservée a plusieurs colis : les articles regroupés y attendront une nouvelle étiquette."
                    : "Aucun bordereau sur la demande conservée : générez ensuite une seule étiquette pour tout le carton."}
                {' '}Les frais de port de la demande regroupée ne sont pas remboursés automatiquement.
              </p>
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
              disabled={submitting || !source}
              className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors text-sm font-medium disabled:opacity-50"
            >
              {submitting ? 'Regroupement...' : 'Regrouper'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MergeShipmentsModal;
