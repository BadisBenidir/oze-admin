import React, { useState } from 'react';
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
  onSubmit: (input: SourcingItemInput) => Promise<{ success: boolean; error?: string }>;
}

/** Ajout d'une pièce sourcée : soit importée du stock existant (recherche
 * serveur, le catalogue complet est trop volumineux pour charger en mémoire
 * comme CreateDropModal le fait pour les seuls brouillons), soit créée à la
 * volée avec juste son prix facturé — voir 0089_b2b_sourcing_missions.sql. */
export const AddSourcingItemModal: React.FC<AddSourcingItemModalProps> = ({ isOpen, onClose, onSubmit }) => {
  const [mode, setMode] = useState<'stock' | 'manual'>('stock');
  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<StockProduct[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<StockProduct | null>(null);

  const [title, setTitle] = useState('');
  const [brand, setBrand] = useState('');
  const [billedPrice, setBilledPrice] = useState('');
  const [costPrice, setCostPrice] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const reset = () => {
    setMode('stock');
    setSearch('');
    setSearchResults([]);
    setSelectedProduct(null);
    setTitle('');
    setBrand('');
    setBilledPrice('');
    setCostPrice('');
    setPhotos([]);
    setError('');
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const runSearch = async (term: string) => {
    setSearch(term);
    if (term.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const { data, error: searchError } = await supabase
        .from('products')
        .select('id, name, product_code, sale_price, purchase_price, images, main_image_index, brand:brands(name)')
        .or(`name.ilike.%${term.trim()}%,product_code.ilike.%${term.trim()}%`)
        .order('created_at', { ascending: false })
        .limit(20);
      if (searchError) throw new Error(searchError.message);
      setSearchResults((data || []) as unknown as StockProduct[]);
    } catch (err) {
      console.error('Erreur lors de la recherche de produits:', err);
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const selectProduct = (product: StockProduct) => {
    setSelectedProduct(product);
    setBilledPrice(String(product.sale_price ?? ''));
    setCostPrice(product.purchase_price != null ? String(product.purchase_price) : '');
  };

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

    const effectiveTitle = mode === 'stock' ? selectedProduct?.name || '' : title.trim();
    if (mode === 'stock' && !selectedProduct) {
      setError('Sélectionne un article du stock');
      return;
    }
    if (!effectiveTitle) {
      setError('Le titre de la pièce est requis');
      return;
    }
    const parsedBilled = Number(billedPrice);
    if (!Number.isFinite(parsedBilled) || parsedBilled <= 0) {
      setError('Le prix de vente prévu doit être supérieur à 0');
      return;
    }
    // Requis (pas juste optionnel) : c'est CE montant qui consomme
    // l'enveloppe d'achat de la mission dès que la pièce est validée — voir
    // 0091_b2b_sourcing_mission_budget_split.sql.
    const parsedCost = Number(costPrice);
    if (!Number.isFinite(parsedCost) || parsedCost < 0) {
      setError("Le prix d'achat est requis pour imputer la pièce sur l'enveloppe d'achat");
      return;
    }

    setSubmitting(true);
    const result = await onSubmit({
      product_id: mode === 'stock' ? selectedProduct?.id : undefined,
      title: effectiveTitle,
      brand: mode === 'stock' ? selectedProduct?.brand?.name : brand.trim() || undefined,
      billed_price: parsedBilled,
      cost_price: parsedCost,
      photos: mode === 'stock' ? (selectedProduct?.images || []) : photos,
    });
    setSubmitting(false);

    if (!result.success) {
      setError(result.error || "Erreur lors de l'ajout de la pièce");
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
                  {selectedProduct ? (
                    <div className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg bg-gray-50">
                      <div className="h-10 w-10 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden">
                        {selectedProduct.images?.length > 0 ? (
                          <img src={selectedProduct.images[selectedProduct.main_image_index] || selectedProduct.images[0]} alt={selectedProduct.name} className="h-full w-full object-cover" />
                        ) : (
                          <Package className="h-4 w-4 text-gray-400" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900 truncate">{selectedProduct.name}</p>
                        <p className="text-xs text-gray-500">{selectedProduct.brand?.name || 'Sans marque'}</p>
                      </div>
                      <button type="button" onClick={() => setSelectedProduct(null)} className="text-xs text-gray-500 hover:text-gray-900 underline flex-shrink-0">
                        Changer
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="relative mb-2">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                        <input
                          type="text"
                          placeholder="Rechercher par nom ou code produit..."
                          value={search}
                          onChange={(e) => runSearch(e.target.value)}
                          className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-gray-400 text-sm"
                        />
                      </div>
                      <div className="border border-gray-200 rounded-lg max-h-56 overflow-y-auto divide-y divide-gray-100">
                        {searching ? (
                          <div className="p-3">
                            <div className="h-10 bg-gray-100 rounded-lg animate-pulse" />
                          </div>
                        ) : search.trim().length < 2 ? (
                          <div className="p-6 text-center text-sm text-gray-500">Tape au moins 2 caractères pour chercher un article.</div>
                        ) : searchResults.length === 0 ? (
                          <div className="p-6 text-center text-sm text-gray-500">Aucun article trouvé pour cette recherche.</div>
                        ) : (
                          searchResults.map((product) => (
                            <button
                              type="button"
                              key={product.id}
                              onClick={() => selectProduct(product)}
                              className="w-full flex items-center gap-3 p-3 hover:bg-gray-50 transition-colors text-left"
                            >
                              <div className="h-9 w-9 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden">
                                {product.images?.length > 0 ? (
                                  <img src={product.images[product.main_image_index] || product.images[0]} alt={product.name} className="h-full w-full object-cover" />
                                ) : (
                                  <Package className="h-4 w-4 text-gray-400" />
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-gray-900 truncate">{product.name}</p>
                                <p className="text-xs text-gray-500">{product.brand?.name || 'Sans marque'} · {product.sale_price.toFixed(0)} €</p>
                              </div>
                            </button>
                          ))
                        )}
                      </div>
                    </>
                  )}
                </div>
              ) : (
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
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="item-cost-price" className="block text-sm font-medium text-gray-700 mb-1">Prix d'achat (imputé sur l'enveloppe)</label>
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
                </div>
                <div>
                  <label htmlFor="item-billed-price" className="block text-sm font-medium text-gray-700 mb-1">Prix de vente prévu</label>
                  <div className="relative">
                    <input
                      id="item-billed-price"
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={billedPrice}
                      onChange={(e) => setBilledPrice(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent pr-8 text-sm"
                      required
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">€</span>
                  </div>
                </div>
              </div>
              <p className="text-xs text-gray-400 -mt-2">
                Le prix d'achat consomme l'enveloppe de la mission une fois la pièce validée — le prix de vente prévu ne sert qu'au suivi de marge par pièce.
              </p>

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
                disabled={submitting}
                className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 text-sm font-medium"
              >
                {submitting ? 'Ajout...' : 'Ajouter la pièce'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default AddSourcingItemModal;
