import React, { useState } from 'react';
import { X, Handshake, AlertCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useResellers } from '../../hooks/useResellers';

interface DirectB2BSaleModalProps {
  productId: string;
  defaultPrice: number;
  onClose: () => void;
  onSuccess: () => void;
}

/**
 * Bascule un produit brouillon directement en vendu B2B, hors plateforme
 * (vente déjà conclue ailleurs). Le revendeur est obligatoire : sans lui,
 * la vente resterait invisible dans le calcul de CA/marge B2B (qui exige
 * une commande rattachée à un reseller_id) — voir admin_record_direct_b2b_sale.
 */
export const DirectB2BSaleModal: React.FC<DirectB2BSaleModalProps> = ({ productId, defaultPrice, onClose, onSuccess }) => {
  const { resellers, loading } = useResellers(true);
  const [resellerId, setResellerId] = useState('');
  const [price, setPrice] = useState(String(defaultPrice || ''));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    if (!resellerId) {
      setError('Veuillez sélectionner un revendeur');
      return;
    }
    setError(null);
    setSubmitting(true);
    const { error: rpcError } = await supabase.rpc('admin_record_direct_b2b_sale', {
      p_product_id: productId,
      p_reseller_id: resellerId,
      p_sale_price: price ? Number(price) : null,
    });
    setSubmitting(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    onSuccess();
  };

  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto">
      <div className="fixed inset-0 bg-black bg-opacity-50" onClick={onClose} />
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between p-5 border-b border-gray-100">
            <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
              <Handshake className="h-4 w-4" /> Vendu B2B (vente directe)
            </h3>
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded-lg transition-colors">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="p-5 space-y-4">
            <p className="text-sm text-gray-500">
              Enregistre une vente déjà conclue hors plateforme : le produit passe directement en "vendu B2B" et une commande minimale est créée pour ce revendeur (compte dans le CA/marge).
            </p>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Revendeur</label>
              <select
                value={resellerId}
                onChange={(e) => setResellerId(e.target.value)}
                disabled={loading}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-gray-400 text-sm bg-white"
              >
                <option value="">Sélectionner...</option>
                {resellers.map((r) => (
                  <option key={r.id} value={r.id}>{r.company_name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Prix de vente (€)</label>
              <input
                type="number"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                min="0"
                step="0.01"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-gray-400 text-sm"
              />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3 p-5 pt-0">
            <button
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors text-sm disabled:opacity-50"
            >
              Annuler
            </button>
            <button
              onClick={handleConfirm}
              disabled={submitting}
              className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors text-sm font-medium disabled:opacity-50"
            >
              {submitting ? 'Enregistrement...' : 'Confirmer la vente'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DirectB2BSaleModal;
