import React, { useEffect, useMemo, useState } from 'react';
import { X, AlertCircle, Search, Package } from 'lucide-react';
import { supabase } from '../../../lib/supabase';

interface StockProduct {
  id: string;
  name: string;
  product_code: string;
  purchase_price: number | null;
  images: string[];
  main_image_index: number;
  brand: { name: string } | null;
}

interface LinkSourcingProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLink: (productId: string) => Promise<{ success: boolean; error?: string }>;
}

/** Lie une pièce "à la volée" (sans fiche produit) à une vraie fiche
 * existante — étape requise avant validation par le revendeur, voir
 * 0098_sourcing_validation_lifecycle.sql. Même source (brouillons) et même
 * pattern de recherche en mémoire que l'onglet "Depuis le stock" de
 * AddSourcingItemModal.tsx, mais sélection unique. */
export const LinkSourcingProductModal: React.FC<LinkSourcingProductModalProps> = ({ isOpen, onClose, onLink }) => {
  const [draftProducts, setDraftProducts] = useState<StockProduct[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setSearch('');
    setSelectedId(null);
    setError('');
    let mounted = true;

    const load = async () => {
      setLoadingProducts(true);
      setLoadError('');
      try {
        const { data, error: fetchError } = await supabase
          .from('products')
          .select('id, name, product_code, purchase_price, images, main_image_index, brand:brands(name)')
          .eq('status', 'draft')
          .order('created_at', { ascending: false });
        if (fetchError) throw new Error(fetchError.message);
        if (mounted) setDraftProducts((data || []) as unknown as StockProduct[]);
      } catch (err) {
        if (mounted) setLoadError(err instanceof Error ? err.message : 'Erreur de chargement des articles');
      } finally {
        if (mounted) setLoadingProducts(false);
      }
    };

    load();
    return () => {
      mounted = false;
    };
  }, [isOpen]);

  const filteredProducts = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return draftProducts;
    return draftProducts.filter(
      (p) =>
        p.name.toLowerCase().includes(term) ||
        p.product_code.toLowerCase().includes(term) ||
        (p.brand?.name || '').toLowerCase().includes(term)
    );
  }, [draftProducts, search]);

  const handleClose = () => {
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedId) {
      setError('Sélectionne une fiche produit');
      return;
    }
    setSubmitting(true);
    setError('');
    const result = await onLink(selectedId);
    setSubmitting(false);
    if (!result.success) {
      setError(result.error || 'Erreur lors de la liaison');
      return;
    }
    handleClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto">
      <div className="fixed inset-0 bg-black bg-opacity-25" onClick={handleClose} />
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between p-5 border-b border-gray-100 flex-shrink-0">
            <h3 className="text-base font-semibold text-gray-900">Lier une fiche produit</h3>
            <button onClick={handleClose} className="p-1 text-gray-400 hover:text-gray-600 rounded-lg transition-colors">
              <X className="h-5 w-5" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
            <div className="p-5 space-y-3 overflow-y-auto flex-1">
              <p className="text-xs text-gray-500">
                Cette pièce a été créée à la volée, sans fiche produit. Lie-la à une fiche existante pour permettre au revendeur de valider sa sélection.
              </p>

              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Filtrer par titre, marque ou référence..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-gray-400 text-sm"
                />
              </div>

              {loadError && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center space-x-2">
                  <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
                  <p className="text-sm text-red-700">{loadError}</p>
                </div>
              )}

              <div className="border border-gray-200 rounded-lg max-h-72 overflow-y-auto divide-y divide-gray-100">
                {loadingProducts ? (
                  [...Array(3)].map((_, i) => (
                    <div key={i} className="p-3">
                      <div className="h-10 bg-gray-100 rounded-lg animate-pulse" />
                    </div>
                  ))
                ) : filteredProducts.length === 0 ? (
                  <div className="p-6 text-center text-sm text-gray-500">
                    {draftProducts.length === 0 ? 'Aucun article en brouillon.' : 'Aucun résultat pour cette recherche.'}
                  </div>
                ) : (
                  filteredProducts.map((product) => (
                    <label
                      key={product.id}
                      className={`flex items-center gap-3 p-3 cursor-pointer transition-colors ${selectedId === product.id ? 'bg-gray-900/5' : 'hover:bg-gray-50'}`}
                    >
                      <input
                        type="radio"
                        name="link-product"
                        checked={selectedId === product.id}
                        onChange={() => setSelectedId(product.id)}
                        className="h-4 w-4 border-gray-300 text-gray-900 focus:ring-gray-900 flex-shrink-0"
                      />
                      <div className="h-9 w-9 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden">
                        {product.images?.length > 0 ? (
                          <img src={product.images[product.main_image_index] || product.images[0]} alt={product.name} className="h-full w-full object-cover" />
                        ) : (
                          <Package className="h-4 w-4 text-gray-400" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900 truncate">{product.name}</p>
                        <p className="text-xs text-gray-500">
                          {product.brand?.name || 'Sans marque'}
                          {product.purchase_price != null && <> · Achat {product.purchase_price.toFixed(0)} €</>}
                        </p>
                      </div>
                    </label>
                  ))
                )}
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center space-x-2">
                  <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}
            </div>

            <div className="flex justify-end space-x-3 p-5 pt-4 border-t border-gray-100 flex-shrink-0">
              <button type="button" onClick={handleClose} className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors text-sm">
                Annuler
              </button>
              <button
                type="submit"
                disabled={submitting || !selectedId}
                className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 text-sm font-medium"
              >
                {submitting ? 'Liaison...' : 'Lier cette fiche'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default LinkSourcingProductModal;
