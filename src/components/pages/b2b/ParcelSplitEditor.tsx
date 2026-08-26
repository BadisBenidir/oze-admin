import React, { useState } from 'react';
import { Plus, Truck, AlertCircle, CheckCircle, ExternalLink, FileDown, Eye } from 'lucide-react';
import { AdminShipmentItem } from '../../../hooks/useAdminShipments';
import { useGenerateShipmentLabels, ParcelResult } from '../../../hooks/useGenerateShipmentLabels';
import { ProductDetail } from '../ProductDetail';
import { isPlausiblePhone } from '../../../utils/phoneValidation';

interface ParcelDraft {
  items: string[];
}

interface ParcelSplitEditorProps {
  shipmentId: string;
  items: AdminShipmentItem[];
  requesterPhone: string | null;
  onGenerated: () => void;
}

const itemRef = (item: AdminShipmentItem) =>
  item.product?.b2b_reference || item.product?.reference || item.product?.product_code || '—';

export const ParcelSplitEditor: React.FC<ParcelSplitEditorProps> = ({ shipmentId, items, requesterPhone, onGenerated }) => {
  const { generate } = useGenerateShipmentLabels();
  const [parcels, setParcels] = useState<ParcelDraft[]>([{ items: items.map((i) => i.id) }]);
  const [generating, setGenerating] = useState(false);
  const [results, setResults] = useState<ParcelResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewingProductId, setViewingProductId] = useState<string | null>(null);
  const phoneMissing = !isPlausiblePhone(requesterPhone);
  const [phoneOverride, setPhoneOverride] = useState('');

  const parcelOf = (itemId: string) => parcels.findIndex((p) => p.items.includes(itemId));

  const moveItem = (itemId: string, targetParcelIndex: number) => {
    setParcels((prev) => prev.map((p, idx) => ({
      items: idx === targetParcelIndex ? [...p.items.filter((id) => id !== itemId), itemId] : p.items.filter((id) => id !== itemId),
    })));
  };

  const addParcel = () => setParcels((prev) => [...prev, { items: [] }]);

  const handleGenerate = async () => {
    const nonEmpty = parcels.filter((p) => p.items.length > 0);
    if (nonEmpty.length === 0) return;
    if (phoneMissing && !isPlausiblePhone(phoneOverride)) {
      setError('Un numéro de téléphone valide est requis par Sendcloud pour générer le bordereau.');
      return;
    }
    setError(null);
    setGenerating(true);
    const result = await generate(shipmentId, nonEmpty.map((p) => ({ item_ids: p.items })), phoneMissing ? phoneOverride.trim() : undefined);
    setGenerating(false);
    if (!result.success) {
      setError(result.error || 'Une erreur est survenue');
      return;
    }
    setResults(result.parcels || []);
    onGenerated();
  };

  const stillPendingCount = items.length - (results || []).filter((r) => r.status === 'shipped').flatMap((r) => r.item_ids).length;

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {results && (
        <div className="space-y-2">
          {results.map((r) => (
            <div key={r.parcel_index} className={`rounded-lg p-3 border ${r.status === 'shipped' ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
              <div className="flex items-center justify-between">
                <p className={`text-sm font-medium ${r.status === 'shipped' ? 'text-green-800' : 'text-red-800'}`}>
                  Colis {r.parcel_index} — {r.status === 'shipped' ? 'expédié' : 'échec'}
                </p>
                {r.status === 'shipped' && r.label_url && (
                  <a href={r.label_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-green-700 underline hover:text-green-900">
                    <FileDown className="h-3.5 w-3.5" /> Étiquette
                  </a>
                )}
              </div>
              {r.status === 'shipped' && r.tracking_number && (
                <p className="text-xs text-green-700 mt-1">
                  Suivi : {r.tracking_number}{' '}
                  {r.tracking_url && (
                    <a href={r.tracking_url} target="_blank" rel="noopener noreferrer" className="underline inline-flex items-center gap-0.5">
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </p>
              )}
              {r.status === 'failed' && <p className="text-xs text-red-700 mt-1">{r.error}</p>}
            </div>
          ))}
          {stillPendingCount > 0 && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
              {stillPendingCount} article{stillPendingCount > 1 ? 's' : ''} reste{stillPendingCount > 1 ? 'nt' : ''} en attente — vous pouvez relancer une génération ci-dessus pour ce qui n'a pas encore été expédié.
            </p>
          )}
        </div>
      )}

      {!results && (
        <>
          <div className="border border-gray-100 rounded-lg overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left py-2 px-3 font-medium text-gray-500 text-xs">Article</th>
                  <th className="text-right py-2 px-3 font-medium text-gray-500 text-xs">Colis</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const current = parcelOf(item.id);
                  const product = item.product;
                  const image = product?.images?.[product.main_image_index] || product?.images?.[0];
                  return (
                    <tr key={item.id} className="border-b border-gray-50 last:border-b-0">
                      <td className="py-2 px-3">
                        <div className="flex items-start gap-3">
                          {image ? (
                            <img src={image} alt={product?.name || 'Article'} className="h-12 w-12 rounded-lg object-cover flex-shrink-0 border border-gray-100" />
                          ) : (
                            <div className="h-12 w-12 rounded-lg bg-gray-100 flex-shrink-0" />
                          )}
                          <div className="min-w-0">
                            <p className="text-sm text-gray-900 font-medium truncate">{product?.name || 'Article'}</p>
                            <p className="text-xs text-gray-500">
                              {product?.brand?.name && <span>{product.brand.name} · </span>}
                              Réf. {itemRef(item)}
                              {product?.condition && <span> · État {product.condition}</span>}
                            </p>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-xs font-medium text-gray-700">{item.line_total.toFixed(2)} €</span>
                              {item.product_id && (
                                <button
                                  type="button"
                                  onClick={() => setViewingProductId(item.product_id)}
                                  className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 hover:underline"
                                >
                                  <Eye className="h-3 w-3" /> Voir la fiche
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-2 px-3 text-right align-top">
                        <div className="inline-flex gap-1">
                          {parcels.map((_, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => moveItem(item.id, idx)}
                              className={`px-2 py-1 text-xs rounded border ${
                                current === idx ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
                              }`}
                            >
                              Colis {idx + 1}
                            </button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <button
            type="button"
            onClick={addParcel}
            className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900"
          >
            <Plus className="h-4 w-4" /> Ajouter un {parcels.length + 1}e colis
          </button>

          {phoneMissing && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <label className="block text-xs font-medium text-amber-800 mb-1">
                Numéro de téléphone manquant ou invalide sur le profil du demandeur — requis par Sendcloud (Mondial Relay en particulier)
              </label>
              <input
                type="tel"
                value={phoneOverride}
                onChange={(e) => setPhoneOverride(e.target.value)}
                placeholder="06 12 34 56 78"
                className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:border-gray-400 ${
                  phoneOverride.length > 0 && !isPlausiblePhone(phoneOverride) ? 'border-red-300' : 'border-gray-200'
                }`}
              />
            </div>
          )}

          <button
            onClick={handleGenerate}
            disabled={generating || parcels.every((p) => p.items.length === 0) || (phoneMissing && !isPlausiblePhone(phoneOverride))}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
          >
            <Truck className="h-4 w-4" />
            {generating ? 'Génération en cours...' : `Générer ${parcels.filter((p) => p.items.length > 0).length > 1 ? 'les étiquettes' : "l'étiquette"}`}
          </button>
        </>
      )}

      {results && stillPendingCount === 0 && (
        <div className="flex items-center gap-2 text-sm text-green-700">
          <CheckCircle className="h-4 w-4" /> Tous les articles de cette demande ont été expédiés.
        </div>
      )}

      {viewingProductId && (
        <div className="fixed inset-0 z-[80] bg-white overflow-y-auto">
          <ProductDetail productId={viewingProductId} onBack={() => setViewingProductId(null)} />
        </div>
      )}
    </div>
  );
};

export default ParcelSplitEditor;
