import React, { useEffect, useMemo, useState } from 'react';
import { X, AlertCircle, Plus, Trash2, Search, Package } from 'lucide-react';
import { supabase } from '../../../../lib/supabase';
import { AuctionItemInput } from '../../../../hooks/useAdminAuctionItems';

const GRADES = ['Grade A', 'Grade B', 'Grade C'];

interface DraftProduct {
  id: string;
  name: string;
  product_code: string;
  images: string[];
  main_image_index: number;
}

interface AuctionItemFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (input: AuctionItemInput, productId: string | null) => Promise<{ success: boolean; error?: string }>;
}

/** Ajout rapide d'un lot à la session sélectionnée — voir auction_items,
 * 0104/0105. La liaison à une fiche produit existante est optionnelle à la
 * création (product_id nullable, 0105) mais obligatoire avant de pouvoir
 * "Générer la commande" une fois le lot adjugé — même contrainte que pour
 * le Sourcing sur mesure (0098) : ce repo ne crée jamais lui-même de
 * marque/catégorie pour une fiche produit inventée à la volée. */
export const AuctionItemFormModal: React.FC<AuctionItemFormModalProps> = ({ isOpen, onClose, onSubmit }) => {
  const [title, setTitle] = useState('');
  const [brand, setBrand] = useState('');
  const [grade, setGrade] = useState(GRADES[1]);
  const [imageUrl, setImageUrl] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [startPrice, setStartPrice] = useState('');
  const [minIncrement, setMinIncrement] = useState('5');
  const [reservePrice, setReservePrice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [productSearch, setProductSearch] = useState('');
  const [draftProducts, setDraftProducts] = useState<DraftProduct[]>([]);
  const [linkedProduct, setLinkedProduct] = useState<DraftProduct | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    supabase
      .from('products')
      .select('id, name, product_code, images, main_image_index')
      .eq('status', 'draft')
      .order('created_at', { ascending: false })
      .then(({ data }) => setDraftProducts((data || []) as DraftProduct[]));
  }, [isOpen]);

  const filteredProducts = useMemo(() => {
    const term = productSearch.trim().toLowerCase();
    if (!term) return draftProducts.slice(0, 20);
    return draftProducts.filter((p) => p.name.toLowerCase().includes(term) || p.product_code.toLowerCase().includes(term)).slice(0, 20);
  }, [draftProducts, productSearch]);

  if (!isOpen) return null;

  const reset = () => {
    setTitle('');
    setBrand('');
    setGrade(GRADES[1]);
    setImageUrl('');
    setImages([]);
    setStartPrice('');
    setMinIncrement('5');
    setReservePrice('');
    setProductSearch('');
    setLinkedProduct(null);
    setError('');
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const addImageUrl = () => {
    const url = imageUrl.trim();
    if (!url) return;
    setImages((prev) => [...prev, url]);
    setImageUrl('');
  };

  const handleSelectProduct = (p: DraftProduct) => {
    setLinkedProduct(p);
    if (!title.trim()) setTitle(p.name);
    if (images.length === 0 && p.images?.length > 0) setImages([p.images[p.main_image_index] || p.images[0]]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !brand.trim()) {
      setError('Titre et marque sont requis');
      return;
    }
    const parsedStart = Number(startPrice);
    if (!Number.isFinite(parsedStart) || parsedStart < 0) {
      setError('Prix de départ invalide');
      return;
    }
    const parsedIncrement = Number(minIncrement);
    if (!Number.isFinite(parsedIncrement) || parsedIncrement <= 0) {
      setError("Pas d'enchère invalide");
      return;
    }
    const parsedReserve = reservePrice.trim() ? Number(reservePrice) : null;
    if (parsedReserve !== null && (!Number.isFinite(parsedReserve) || parsedReserve < 0)) {
      setError('Prix de réserve invalide');
      return;
    }

    setSubmitting(true);
    setError('');
    const result = await onSubmit(
      { title: title.trim(), brand: brand.trim(), grade, images, start_price: parsedStart, min_increment: parsedIncrement, reserve_price: parsedReserve },
      linkedProduct?.id || null
    );
    setSubmitting(false);
    if (!result.success) {
      setError(result.error || "Erreur lors de l'ajout du lot");
      return;
    }
    handleClose();
  };

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto">
      <div className="fixed inset-0 bg-black bg-opacity-25" onClick={handleClose} />
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between p-5 border-b border-gray-100 flex-shrink-0">
            <h3 className="text-base font-semibold text-gray-900">Ajouter une pièce</h3>
            <button onClick={handleClose} className="p-1 text-gray-400 hover:text-gray-600 rounded-lg transition-colors">
              <X className="h-5 w-5" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
            <div className="p-5 space-y-4 overflow-y-auto flex-1">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Fiche produit existante (optionnel)</label>
                {linkedProduct ? (
                  <div className="flex items-center justify-between px-3 py-2 border border-gray-200 rounded-lg bg-gray-50">
                    <span className="text-sm text-gray-900 truncate">{linkedProduct.name}</span>
                    <button type="button" onClick={() => setLinkedProduct(null)} className="text-gray-400 hover:text-red-600 flex-shrink-0">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="relative mb-1.5">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                      <input
                        type="text"
                        value={productSearch}
                        onChange={(e) => setProductSearch(e.target.value)}
                        placeholder="Rechercher par titre ou référence..."
                        className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-400"
                      />
                    </div>
                    <div className="border border-gray-200 rounded-lg max-h-40 overflow-y-auto divide-y divide-gray-100">
                      {filteredProducts.length === 0 ? (
                        <div className="p-3 text-center text-xs text-gray-500">
                          {draftProducts.length === 0 ? 'Aucun article en brouillon.' : 'Aucun résultat pour cette recherche.'}
                        </div>
                      ) : (
                        filteredProducts.map((p) => (
                          <button
                            type="button"
                            key={p.id}
                            onClick={() => handleSelectProduct(p)}
                            className="w-full flex items-center gap-2 p-2 text-left hover:bg-gray-50"
                          >
                            <div className="h-8 w-8 bg-gray-100 rounded flex items-center justify-center overflow-hidden flex-shrink-0">
                              {p.images?.[0] ? <img src={p.images[0]} alt="" className="h-full w-full object-cover" /> : <Package className="h-3.5 w-3.5 text-gray-400" />}
                            </div>
                            <span className="text-xs text-gray-800 truncate">{p.name}</span>
                          </button>
                        ))
                      )}
                    </div>
                  </>
                )}
                <p className="text-xs text-gray-400 mt-1">Nécessaire pour pouvoir générer une commande une fois le lot adjugé — peut être lié plus tard.</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Titre</label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Ex : Louis Vuitton Speedy 30 Monogram"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Marque</label>
                  <input
                    type="text"
                    value={brand}
                    onChange={(e) => setBrand(e.target.value)}
                    placeholder="Ex : Louis Vuitton"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">État / Grade</label>
                  <select
                    value={grade}
                    onChange={(e) => setGrade(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-sm bg-white"
                  >
                    {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Photos (URLs)</label>
                <div className="flex gap-2 mb-2">
                  <input
                    type="text"
                    value={imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                    placeholder="https://..."
                    className="flex-1 min-w-0 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-sm"
                  />
                  <button type="button" onClick={addImageUrl} className="px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm flex-shrink-0">
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
                {images.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {images.map((url, i) => (
                      <div key={i} className="relative h-14 w-14 rounded-lg overflow-hidden border border-gray-200 group">
                        <img src={url} alt="" className="h-full w-full object-cover" onError={(e) => (e.currentTarget.style.opacity = '0.3')} />
                        <button
                          type="button"
                          onClick={() => setImages((prev) => prev.filter((_, idx) => idx !== i))}
                          className="absolute inset-0 bg-black bg-opacity-40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"
                        >
                          <Trash2 className="h-4 w-4 text-white" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Prix de départ</label>
                  <input
                    type="number" min="0" step="0.01"
                    value={startPrice}
                    onChange={(e) => setStartPrice(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Pas mini.</label>
                  <input
                    type="number" min="0.01" step="0.01"
                    value={minIncrement}
                    onChange={(e) => setMinIncrement(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Réserve (opt.)</label>
                  <input
                    type="number" min="0" step="0.01"
                    value={reservePrice}
                    onChange={(e) => setReservePrice(e.target.value)}
                    placeholder="Invisible"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-sm"
                  />
                </div>
              </div>
              <p className="text-xs text-gray-400">
                La durée de ce lot est calée automatiquement sur la fin de la session — le compte à rebours pourra ensuite être prolongé lot par lot (anti-snipe, +5 min par enchère de dernière minute).
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

export default AuctionItemFormModal;
