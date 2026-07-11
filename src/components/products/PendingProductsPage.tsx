import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Card, CardContent } from '../ui/Card';
import { Modal } from '../ui/Modal';
import { ProductLabel } from './ProductLabel';
import { BarcodeScanner } from './BarcodeScanner';
import { validateProductByBarcode } from '../../services/productValidationService';
import { Package, Edit, Eye, Tag, Trash2, ScanLine, Image as ImageIcon, AlertCircle } from 'lucide-react';

interface PendingProduct {
  id: string;
  name: string;
  reference: string | null;
  barcode: string | null;
  images: string[];
  main_image_index: number;
  created_at: string;
  brand?: { name: string } | null;
}

interface PendingProductsPageProps {
  /** Ouvre l'éditeur du produit (ajout/retouche photos, etc.). */
  onEdit: (productId: string) => void;
  /** Ouvre la fiche détail du produit. */
  onView: (productId: string) => void;
}

/**
 * Espace « En attente de mise en ligne » : tous les articles au statut `draft`
 * (à valider). Workflow : créer vite → peaufiner les photos ici → scanner le
 * code-barres → l'article passe « en vente en ligne » et quitte cette liste.
 */
export const PendingProductsPage: React.FC<PendingProductsPageProps> = ({ onEdit, onView }) => {
  const [items, setItems] = useState<PendingProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [labelProduct, setLabelProduct] = useState<{ name: string; reference: string; brandName?: string } | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanMsg, setScanMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const fetchPending = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase
      .from('products')
      .select('id, name, reference, barcode, images, main_image_index, created_at, brand:brands(name)')
      .eq('status', 'draft')
      .order('created_at', { ascending: false });
    if (error) setError(error.message);
    else setItems((data as unknown as PendingProduct[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchPending();
  }, [fetchPending]);

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Supprimer définitivement le produit « ${name} » ?`)) return;
    const { error } = await supabase.from('products').delete().eq('id', id);
    if (error) {
      setScanMsg({ ok: false, text: `Suppression impossible : ${error.message}` });
      return;
    }
    fetchPending();
  };

  const handleScan = async (code: string) => {
    const outcome = await validateProductByBarcode(code);
    if (outcome.status === 'validated' || outcome.status === 'already-online') {
      setScanMsg({
        ok: true,
        text:
          outcome.status === 'validated'
            ? `${outcome.productName} mis en ligne ✅`
            : `${outcome.productName} était déjà en ligne`,
      });
      setScanOpen(false);
      fetchPending();
    } else if (outcome.status === 'no-photos') {
      setScanMsg({ ok: false, text: `${outcome.productName} : ajoute au moins une photo avant la mise en ligne.` });
    } else if (outcome.status === 'no-price') {
      setScanMsg({ ok: false, text: `${outcome.productName} : renseigne un prix de vente avant la mise en ligne.` });
    } else if (outcome.status === 'not-found') {
      setScanMsg({ ok: false, text: 'Référence inconnue' });
    } else {
      setScanMsg({ ok: false, text: outcome.message });
    }
  };

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4 md:mb-6 flex items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">En attente de mise en ligne</h3>
          <p className="text-sm text-gray-500">
            {loading ? 'Chargement...' : `${items.length} article${items.length > 1 ? 's' : ''} à finaliser puis scanner`}
          </p>
        </div>
        <button
          onClick={() => { setScanMsg(null); setScanOpen(true); }}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-medium"
        >
          <ScanLine className="h-4 w-4" />
          Scanner pour mettre en ligne
        </button>
      </div>

      {scanMsg && (
        <div className={`mb-4 rounded-lg border p-3 text-sm ${scanMsg.ok ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
          {scanMsg.text}
        </div>
      )}

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3">
          <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {!loading && items.length === 0 && !error && (
        <Card>
          <CardContent className="p-10 text-center text-gray-500">
            <Package className="h-10 w-10 mx-auto mb-3 text-gray-300" />
            Aucun article en attente. Les nouveaux articles apparaissent ici jusqu'au scan.
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.map((product) => {
          const thumb = product.images?.[product.main_image_index] || product.images?.[0];
          const photoCount = product.images?.length || 0;
          return (
            <Card key={product.id}>
              <CardContent className="p-4">
                <div className="flex gap-3">
                  <div className="h-16 w-16 flex-shrink-0 rounded-lg bg-gray-100 overflow-hidden flex items-center justify-center">
                    {thumb ? (
                      <img src={thumb} alt={product.name} className="h-full w-full object-cover" />
                    ) : (
                      <Package className="h-6 w-6 text-gray-400" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-gray-900 truncate">{product.name}</p>
                    <p className="text-xs text-gray-500 truncate">{product.brand?.name || 'Sans marque'}</p>
                    {product.reference && (
                      <p className="mt-0.5 font-mono text-xs text-gray-600">{product.reference}</p>
                    )}
                    <p className={`mt-1 inline-flex items-center gap-1 text-xs ${photoCount === 0 ? 'text-orange-600' : 'text-gray-500'}`}>
                      <ImageIcon className="h-3 w-3" />
                      {photoCount} photo{photoCount > 1 ? 's' : ''}
                    </p>
                  </div>
                </div>

                <div className="mt-3 flex items-center gap-1 border-t border-gray-100 pt-3">
                  <button
                    onClick={() => onEdit(product.id)}
                    className="flex-1 flex items-center justify-center gap-1 px-2 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                    title="Éditer (photos, infos)"
                  >
                    <Edit className="h-4 w-4" /> Éditer
                  </button>
                  <button
                    onClick={() => onView(product.id)}
                    className="p-2 text-gray-400 hover:text-blue-600 transition-colors"
                    title="Voir la fiche"
                  >
                    <Eye className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => product.reference && setLabelProduct({
                      name: product.name,
                      reference: product.reference,
                      brandName: product.brand?.name,
                    })}
                    disabled={!product.reference}
                    className="p-2 text-gray-400 hover:text-gray-900 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    title="Étiquette"
                  >
                    <Tag className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(product.id, product.name)}
                    className="p-2 text-gray-400 hover:text-red-600 transition-colors"
                    title="Supprimer"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Modale étiquette */}
      <Modal isOpen={Boolean(labelProduct)} onClose={() => setLabelProduct(null)} title="Étiquette produit">
        {labelProduct && (
          <ProductLabel name={labelProduct.name} reference={labelProduct.reference} brandName={labelProduct.brandName} />
        )}
      </Modal>

      {/* Modale scan (mise en ligne) */}
      <Modal isOpen={scanOpen} onClose={() => setScanOpen(false)} title="Scanner pour mettre en ligne">
        <div className="space-y-3">
          <p className="text-sm text-gray-600">Vise le QR Code de l'étiquette ; l'article passe en vente en ligne.</p>
          <BarcodeScanner onDetected={handleScan} />
          {scanMsg && !scanMsg.ok && <p className="text-sm text-red-600">{scanMsg.text}</p>}
        </div>
      </Modal>
    </div>
  );
};