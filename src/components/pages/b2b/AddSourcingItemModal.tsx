import React, { useEffect, useMemo, useState } from 'react';
import { X, AlertCircle, Search, Package, Image as ImageIcon } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { SourcingItemInput } from '../../../hooks/useSourcingItems';

interface StockProduct {
  id: string;
  name: string;
  product_code: string;
  sale_price: number;
  purchase_price: number | null;
  images: string[];
  main_image_index: number;
  brand: { name: string } | null;
}

interface AddSourcingItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Mode "Nouvelle pièce" : une pièce ad hoc, saisie manuellement. */
  onSubmit: (input: SourcingItemInput) => Promise<{ success: boolean; error?: string }>;
  /** Mode "Depuis le stock" : plusieurs pièces à la fois, une seule requête d'insertion. */
  onSubmitBatch: (inputs: SourcingItemInput[]) => Promise<{ success: boolean; error?: string }>;
  /** Reste actuel de l'enveloppe d'achat, pour afficher le reste après validation. */
  remainingCostBudget: number;
}

/** Ajout de pièce(s) sourcée(s) : soit une sélection multiple depuis le stock
 * existant (tous les brouillons chargés à l'ouverture, filtrés en mémoire à
 * la frappe — même pattern que CreateDropModal.tsx), soit une pièce créée à
 * la volée — voir 0089_b2b_sourcing_missions.sql. */
export const AddSourcingItemModal: React.FC<AddSourcingItemModalProps> = ({ isOpen, onClose, onSubmit, onSubmitBatch, remainingCostBudget }) => {
  const [mode, setMode] = useState<'stock' | 'manual'>('stock');
  const [draftProducts, setDraftProducts] = useState<StockProduct[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());

  const [title, setTitle] = useState('');
  const [brand, setBrand] = useState('');
  const [costPrice, setCostPrice] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const reset = () => {
    setMode('stock');
    setSearch('');
    setSelectedProductIds(new Set());
    setTitle('');
    setBrand('');
    setCostPrice('');
    setPhotos([]);
    setError('');
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  // Chargé une fois à l'ouverture — le catalogue de brouillons reste petit
  // (contrairement au catalogue complet), donc pas besoin d'une recherche
  // serveur à la frappe : on filtre en mémoire (voir filteredProducts).
  useEffect(() => {
    if (!isOpen) return;
    let mounted = true;

    const loadDraftProducts = async () => {
      setLoadingProducts(true);
      setLoadError('');
      try {
        const { data, error: fetchError } = await supabase
          .from('products')
          .select('id, name, product_code, sale_price, purchase_price, images, main_image_index, brand:brands(name)')
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

    loadDraftProducts();
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

  const toggleProduct = (id: string) => {
    setSelectedProductIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allFilteredSelected = filteredProducts.length > 0 && filteredProducts.every((p) => selectedProductIds.has(p.id));
  const toggleSelectAll = () => {
    setSelectedProductIds((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        for (const p of filteredProducts) next.delete(p.id);
      } else {
        for (const p of filteredProducts) next.add(p.id);
      }
      return next;
    });
  };

  const selectedProducts = useMemo(
    () => draftProducts.filter((p) => selectedProductIds.has(p.id)),
    [draftProducts, selectedProductIds]
  );
  const totalSelectedCost = selectedProducts.reduce((sum, p) => sum + (p.purchase_price ?? 0), 0);
  const remainingAfter = remainingCostBudget - totalSelectedCost;

  const handleUploadPhoto = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const imageFiles = Array.from(files).filter((f) => f.type.startsWith('image/') && f.size <= 10 * 1024 * 1024);
    if (imageFiles.length === 0) return;
    setUploadingPhoto(true);
    try {
      const urls: string[] = [];
      for (const file of imageFiles) {
        const ext = file.name.split('.').pop();
        const fileName = `sourcing-${Date.now()}-${Math.random().toString(36).substring(2)}.${ext}`;
        const { error: upErr } = await supabase.storage.from('products-images').upload(fileName, file, { cacheControl: '3600', upsert: false });
        if (upErr) { console.error('Upload échoué:', upErr); continue; }
        const { data: { publicUrl } } = supabase.storage.from('products-images').getPublicUrl(fileName);
        urls.push(publicUrl);
      }
      if (urls.length) setPhotos((prev) => [...prev, ...urls]);
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (mode === 'stock') {
      if (selectedProducts.length === 0) {
        setError('Sélectionne au moins un article du stock');
        return;
      }
      setSubmitting(true);
      // Coût d'achat pris automatiquement sur la fiche produit (fallback 0
      // si non renseigné) — voir demande explicite : pas de saisie manuelle
      // par pièce dans ce flux de sélection multiple.
      const result = await onSubmitBatch(
        selectedProducts.map((p) => ({
          product_id: p.id,
          title: p.name,
          brand: p.brand?.name,
          cost_price: p.purchase_price ?? 0,
          photos: p.images || [],
        }))
      );
      setSubmitting(false);
      if (!result.success) {
        setError(result.error || "Erreur lors de l'ajout des pièces");
        return;
      }
      handleClose();
      return;
    }

    const effectiveTitle = title.trim();
    if (!effectiveTitle) {
      setError('Le titre de la pièce est requis');
      return;
    }
    const parsedCost = Number(costPrice);
    if (!Number.isFinite(parsedCost) || parsedCost < 0) {
      setError("Le prix d'achat est requis pour imputer la pièce sur l'enveloppe d'achat");
      return;
    }

    setSubmitting(true);
    const result = await onSubmit({
      title: effectiveTitle,
      brand: brand.trim() || undefined,
      cost_price: parsedCost,
      photos,
    });
    setSubmitting(false);

    if (!result.success) {
      setError(result.error || "Erreur lors de l'ajout de la pièce");
      return;
    }
    handleClose();
  };

  if (!isOpen) return null;

  const submitLabel = mode === 'stock'
    ? selectedProducts.length > 1
      ? `Ajouter les ${selectedProducts.length} pièces`
      : 'Ajouter la pièce'
    : 'Ajouter la pièce';

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto">
      <div className="fixed inset-0 bg-black bg-opacity-25" onClick={handleClose} />
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between p-5 border-b border-gray-100 flex-shrink-0">
            <h3 className="text-base font-semibold text-gray-900">Ajouter une pièce sourcée</h3>
            <button onClick={handleClose} className="p-1 text-gray-400 hover:text-gray-600 rounded-lg transition-colors">
              <X className="h-5 w-5" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
            <div className="p-5 space-y-4 overflow-y-auto flex-1">
              <div className="flex rounded-lg border border-gray-200 p-1 text-sm">
                <button
                  type="button"
                  onClick={() => { setMode('stock'); setError(''); }}
                  className={`flex-1 py-1.5 rounded-md transition-colors ${mode === 'stock' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
                >
                  Depuis le stock
                </button>
                <button
                  type="button"
                  onClick={() => { setMode('manual'); setError(''); }}
                  className={`flex-1 py-1.5 rounded-md transition-colors ${mode === 'manual' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
                >
                  Nouvelle pièce
                </button>
              </div>

              {mode === 'stock' ? (
                <div>
                  <div className="relative mb-2">
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
                    <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center space-x-2 mb-2">
                      <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
                      <p className="text-sm text-red-700">{loadError}</p>
                    </div>
                  )}

                  {!loadingProducts && filteredProducts.length > 0 && (
                    <div className="flex items-center justify-between mb-2">
                      <button
                        type="button"
                        onClick={toggleSelectAll}
                        className="text-xs text-gray-600 hover:text-gray-900 underline"
                      >
                        {allFilteredSelected ? 'Tout désélectionner' : 'Tout sélectionner'}
                      </button>
                      {selectedProducts.length > 0 && (
                        <span className="text-xs text-gray-500">{selectedProducts.length} sélectionné{selectedProducts.length > 1 ? 's' : ''}</span>
                      )}
                    </div>
                  )}

                  <div className="border border-gray-200 rounded-lg max-h-64 overflow-y-auto divide-y divide-gray-100">
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
                      filteredProducts.map((product) => {
                        const isSelected = selectedProductIds.has(product.id);
                        return (
                          <label
                            key={product.id}
                            className={`flex items-center gap-3 p-3 cursor-pointer transition-colors ${isSelected ? 'bg-gray-900/5' : 'hover:bg-gray-50'}`}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleProduct(product.id)}
                              className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-900 flex-shrink-0"
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
                        );
                      })
                    )}
                  </div>

                  {selectedProducts.length > 0 && (
                    <div className="mt-3 bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-600">{selectedProducts.length} article{selectedProducts.length > 1 ? 's' : ''} sélectionné{selectedProducts.length > 1 ? 's' : ''}</span>
                        <span className="font-semibold text-gray-900">Total achat : {totalSelectedCost.toFixed(2)} €</span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-gray-400">Reste sur l'enveloppe après validation</span>
                        <span className={`font-medium ${remainingAfter < 0 ? 'text-red-600' : 'text-gray-600'}`}>{remainingAfter.toFixed(2)} €</span>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2">
                      <label htmlFor="item-title" className="block text-sm font-medium text-gray-700 mb-1">Titre de la pièce</label>
                      <input
                        id="item-title"
                        type="text"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="Ex : Sac Speedy 30"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-sm"
                      />
                    </div>
                    <div className="col-span-2">
                      <label htmlFor="item-brand" className="block text-sm font-medium text-gray-700 mb-1">Marque</label>
                      <input
                        id="item-brand"
                        type="text"
                        value={brand}
                        onChange={(e) => setBrand(e.target.value)}
                        placeholder="Ex : Louis Vuitton"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-sm"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-1">Photos</label>
                      <div className="flex items-center gap-2 flex-wrap">
                        {photos.map((url, i) => (
                          <div key={i} className="h-14 w-14 rounded-lg overflow-hidden border border-gray-200 relative group">
                            <img src={url} alt="" className="h-full w-full object-cover" />
                            <button
                              type="button"
                              onClick={() => setPhotos((prev) => prev.filter((_, idx) => idx !== i))}
                              className="absolute inset-0 bg-black bg-opacity-40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"
                            >
                              <X className="h-4 w-4 text-white" />
                            </button>
                          </div>
                        ))}
                        <label className="h-14 w-14 rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center cursor-pointer hover:border-gray-400 transition-colors flex-shrink-0">
                          {uploadingPhoto ? (
                            <div className="h-4 w-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
                          ) : (
                            <ImageIcon className="h-5 w-5 text-gray-400" />
                          )}
                          <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => handleUploadPhoto(e.target.files)} />
                        </label>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="item-cost-price" className="block text-sm font-medium text-gray-700 mb-1">Coût d'achat réel</label>
                    <div className="relative">
                      <input
                        id="item-cost-price"
                        type="number"
                        min="0"
                        step="0.01"
                        value={costPrice}
                        onChange={(e) => setCostPrice(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent pr-8 text-sm"
                        required
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">€</span>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">
                      Ce montant s'impute directement sur l'enveloppe d'achat de la mission une fois la pièce validée.
                    </p>
                  </div>
                </>
              )}

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
                disabled={submitting || (mode === 'stock' && selectedProducts.length === 0)}
                className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 text-sm font-medium"
              >
                {submitting ? 'Ajout...' : submitLabel}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default AddSourcingItemModal;
