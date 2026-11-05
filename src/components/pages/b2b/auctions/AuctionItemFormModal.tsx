import React, { useEffect, useMemo, useState } from 'react';
import { X, AlertCircle, Plus, Trash2, Search, Package } from 'lucide-react';
import { supabase } from '../../../../lib/supabase';
import { AuctionItemInput } from '../../../../hooks/useAdminAuctionItems';

const GRADES = ['Grade S', 'Grade A', 'Grade AB', 'Grade B', 'Grade BC', 'Grade C', 'Grade D'];
const DEFAULT_GRADE = 'Grade B';

interface DraftProduct {
  id: string;
  name: string;
  product_code: string;
  /** Numéro fournisseur (ex. 889-36841). */
  source_reference: string | null;
  images: string[];
  main_image_index: number;
  condition: string | null;
  /** Prix d'achat fournisseur (affiché pour caler le prix de départ). */
  purchase_price: number | null;
  brand: { name: string } | null;
}

const eur = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });

/** Grade d'un lot recopié tel quel depuis products.condition (grades lettrés
 * S/A/AB/B/BC/C/D, voir productGrade.ts) — plus d'arrondi à 3 paliers, qui
 * affichait par ex. « Grade C » pour une pièce BC. Les anciens libellés texte
 * (neuf/excellent/very-good/good/fair) sont convertis vers le grade équivalent. */
const conditionToAuctionGrade = (condition: string | null): string => {
  switch (condition) {
    case 'S': case 'A': case 'AB': case 'B': case 'BC': case 'C': case 'D':
      return `Grade ${condition}`;
    case 'neuf':
      return 'Grade S';
    case 'excellent':
      return 'Grade A';
    case 'very-good':
      return 'Grade AB';
    case 'fair':
      return 'Grade C';
    default:
      return 'Grade B';
  }
};

interface AuctionItemFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (input: AuctionItemInput, productId: string | null) => Promise<{ success: boolean; error?: string }>;
  /** product_id des lots déjà présents sur CETTE session — grisés et non
   * sélectionnables pour éviter d'ajouter deux fois le même article (même
   * pattern que AddSourcingItemModal.tsx/existingProductIds). */
  existingProductIds: Set<string>;
}

/** Ajout rapide d'un lot à la session sélectionnée — voir auction_items,
 * 0104/0105. La liaison à une fiche produit existante est optionnelle à la
 * création (product_id nullable, 0105) mais obligatoire avant de pouvoir
 * "Générer la commande" une fois le lot adjugé — même contrainte que pour
 * le Sourcing sur mesure (0098) : ce repo ne crée jamais lui-même de
 * marque/catégorie pour une fiche produit inventée à la volée. */
export const AuctionItemFormModal: React.FC<AuctionItemFormModalProps> = ({ isOpen, onClose, onSubmit, existingProductIds }) => {
  const [title, setTitle] = useState('');
  const [brand, setBrand] = useState('');
  const [grade, setGrade] = useState(DEFAULT_GRADE);
  const [imageUrl, setImageUrl] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [startPrice, setStartPrice] = useState('0');
  const [minIncrement, setMinIncrement] = useState('5');
  const [reservePrice, setReservePrice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState('');

  const [productSearch, setProductSearch] = useState('');
  const [draftProducts, setDraftProducts] = useState<DraftProduct[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  // Fiches cochées : un lot par fiche, mêmes prix de départ / pas / réserve.
  const [selected, setSelected] = useState<DraftProduct[]>([]);

  // 'draft-b2b' (0130) : articles créés directement depuis Produits B2B,
  // liables à un lot d'enchère au même titre qu'un brouillon classique.
  // Les articles déjà liés à un lot en cours ou adjugé (toutes sessions) restent
  // en brouillon côté products : on les exclut ici. Un lot non vendu ou annulé
  // libère l'article, qui peut être remis en vente dans une autre session.
  useEffect(() => {
    if (!isOpen) return;
    setLoadingProducts(true);
    Promise.all([
      supabase
        .from('products')
        .select('id, name, product_code, source_reference, images, main_image_index, condition, purchase_price, brand:brands(name)')
        .in('status', ['draft', 'draft-b2b'])
        .order('created_at', { ascending: false }),
      supabase
        .from('auction_items')
        .select('product_id')
        .not('product_id', 'is', null)
        .in('status', ['active', 'sold']),
    ]).then(([{ data: products }, { data: engaged }]) => {
      const inAuction = new Set((engaged || []).map((i) => i.product_id as string));
      setDraftProducts(((products || []) as unknown as DraftProduct[]).filter((p) => !inAuction.has(p.id)));
      setLoadingProducts(false);
    });
  }, [isOpen]);

  const filteredProducts = useMemo(() => {
    const term = productSearch.trim().toLowerCase();
    if (!term) return draftProducts;
    return draftProducts.filter((p) =>
      `${p.name} ${p.product_code} ${p.source_reference || ''} ${p.brand?.name || ''}`.toLowerCase().includes(term)
    );
  }, [draftProducts, productSearch]);

  if (!isOpen) return null;

  const selectedIds = new Set(selected.map((p) => p.id));
  const selectable = filteredProducts.filter((p) => !existingProductIds.has(p.id));
  const allFilteredSelected = selectable.length > 0 && selectable.every((p) => selectedIds.has(p.id));

  const reset = () => {
    setTitle('');
    setBrand('');
    setGrade(DEFAULT_GRADE);
    setImageUrl('');
    setImages([]);
    setStartPrice('0');
    setMinIncrement('5');
    setReservePrice('');
    setProductSearch('');
    setSelected([]);
    setProgress(null);
    setError('');
  };

  const handleClose = () => {
    if (submitting) return;
    reset();
    onClose();
  };

  const addImageUrl = () => {
    const url = imageUrl.trim();
    if (!url) return;
    setImages((prev) => [...prev, url]);
    setImageUrl('');
  };

  const toggleProduct = (p: DraftProduct) => {
    setSelected((prev) => (prev.some((x) => x.id === p.id) ? prev.filter((x) => x.id !== p.id) : [...prev, p]));
  };

  const toggleAllFiltered = () => {
    if (allFilteredSelected) {
      const ids = new Set(selectable.map((p) => p.id));
      setSelected((prev) => prev.filter((p) => !ids.has(p.id)));
    } else {
      setSelected((prev) => [...prev, ...selectable.filter((p) => !prev.some((x) => x.id === p.id))]);
    }
  };

  // La fiche liée porte déjà titre/marque/état/photos — on les reprend tels
  // quels (jamais ressaisis) plutôt que de dupliquer une description déjà
  // faite ailleurs, voir demande explicite.
  const lotFromProduct = (p: DraftProduct) => ({
    title: p.name,
    brand: p.brand?.name || '',
    grade: conditionToAuctionGrade(p.condition),
    images: p.images?.length > 0 ? [p.images[p.main_image_index] || p.images[0], ...p.images.filter((_, i) => i !== p.main_image_index)] : [],
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selected.length === 0 && (!title.trim() || !brand.trim())) {
      setError('Sélectionnez au moins une fiche, ou saisissez un titre et une marque');
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
    const prices = { start_price: parsedStart, min_increment: parsedIncrement, reserve_price: parsedReserve };

    setSubmitting(true);
    setError('');
    if (selected.length === 0) {
      const result = await onSubmit({ title: title.trim(), brand: brand.trim(), grade, images, ...prices }, null);
      setSubmitting(false);
      if (!result.success) return setError(result.error || "Erreur lors de l'ajout du lot");
      reset();
      onClose();
      return;
    }

    const failed: string[] = [];
    for (let i = 0; i < selected.length; i += 1) {
      const p = selected[i];
      setProgress(`${i + 1}/${selected.length}`);
      const lot = lotFromProduct(p);
      if (!lot.brand) {
        failed.push(`${p.name} (marque manquante)`);
        continue;
      }
      const result = await onSubmit({ ...lot, ...prices }, p.id);
      if (!result.success) failed.push(`${p.name} (${result.error || 'erreur'})`);
    }
    setSubmitting(false);
    setProgress(null);
    if (failed.length > 0) {
      const failedIds = new Set(selected.filter((p) => failed.some((f) => f.startsWith(p.name))).map((p) => p.id));
      setSelected((prev) => prev.filter((p) => failedIds.has(p.id)));
      setError(`${selected.length - failed.length} pièce(s) ajoutée(s). Échec pour : ${failed.join(', ')}`);
      return;
    }
    reset();
    onClose();
  };

  const thumb = (p: DraftProduct) => p.images?.[p.main_image_index] || p.images?.[0];

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto">
      <div className="fixed inset-0 bg-black bg-opacity-25" onClick={handleClose} />
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
            <h3 className="text-lg font-semibold text-gray-900">Ajouter des pièces</h3>
            <button onClick={handleClose} className="p-1 text-gray-400 hover:text-gray-600 rounded-lg transition-colors">
              <X className="h-5 w-5" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
            <div className="px-6 py-5 space-y-5 overflow-y-auto flex-1">
              <div>
                <div className="flex flex-wrap items-end justify-between gap-2 mb-2">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">Articles en brouillon ({draftProducts.length})</p>
                    <p className="text-xs text-gray-500">Cochez une ou plusieurs fiches : un lot est créé pour chacune, avec ses photos, sa marque et son état.</p>
                  </div>
                  {selectable.length > 0 && (
                    <button type="button" onClick={toggleAllFiltered} className="text-sm font-medium text-gray-700 underline hover:text-gray-900">
                      {allFilteredSelected ? 'Tout désélectionner' : `Tout sélectionner (${selectable.length})`}
                    </button>
                  )}
                </div>
                <div className="relative mb-2">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    placeholder="Rechercher : titre, marque, référence ou numéro fournisseur…"
                    className="w-full pl-9 pr-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-400"
                  />
                </div>
                <div className="border border-gray-200 rounded-lg max-h-[22rem] overflow-y-auto divide-y divide-gray-100">
                  {loadingProducts ? (
                    <div className="p-6 text-center text-sm text-gray-500">Chargement des brouillons…</div>
                  ) : filteredProducts.length === 0 ? (
                    <div className="p-6 text-center text-sm text-gray-500">
                      {draftProducts.length === 0 ? 'Aucun article en brouillon.' : 'Aucun résultat pour cette recherche.'}
                    </div>
                  ) : (
                    filteredProducts.map((p) => {
                      const alreadyAdded = existingProductIds.has(p.id);
                      const checked = selectedIds.has(p.id);
                      const image = thumb(p);
                      return (
                        <label
                          key={p.id}
                          title={alreadyAdded ? 'Déjà ajouté à cette session' : undefined}
                          className={`flex items-center gap-3 px-3 py-2.5 ${
                            alreadyAdded ? 'opacity-40 cursor-not-allowed' : checked ? 'bg-gray-50 cursor-pointer' : 'hover:bg-gray-50 cursor-pointer'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={alreadyAdded}
                            onChange={() => toggleProduct(p)}
                            className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-400 flex-shrink-0"
                          />
                          <div className="h-14 w-14 bg-gray-100 rounded-lg flex items-center justify-center overflow-hidden flex-shrink-0 border border-gray-100">
                            {image ? <img src={image} alt="" className="h-full w-full object-cover" loading="lazy" /> : <Package className="h-5 w-5 text-gray-400" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-gray-900 truncate">{p.name}</p>
                            <p className="text-xs text-gray-500 truncate">
                              {p.brand?.name || 'Sans marque'} · {conditionToAuctionGrade(p.condition)}
                              {p.source_reference && <span className="font-mono"> · {p.source_reference}</span>}
                            </p>
                          </div>
                          <div className="flex-shrink-0 text-right">
                            <p className="text-sm font-semibold tabular-nums text-gray-900">
                              {p.purchase_price != null ? eur(Number(p.purchase_price)) : '—'}
                            </p>
                            <p className="text-[11px] text-gray-400">prix d'achat</p>
                          </div>
                          {alreadyAdded && <span className="text-xs text-gray-500 flex-shrink-0">Déjà ajouté</span>}
                        </label>
                      );
                    })
                  )}
                </div>
                {selected.length > 0 && (
                  <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-gray-900 px-3 py-2 text-sm text-white">
                    <span>
                      {selected.length} pièce{selected.length > 1 ? 's' : ''} sélectionnée{selected.length > 1 ? 's' : ''}
                      <span className="text-gray-300"> · {eur(selected.reduce((t, p) => t + (Number(p.purchase_price) || 0), 0))} d'achat au total</span>
                    </span>
                    <button type="button" onClick={() => setSelected([])} className="text-xs text-gray-300 underline hover:text-white">
                      Vider la sélection
                    </button>
                  </div>
                )}
              </div>

              {selected.length === 0 && (
                <details className="rounded-lg border border-gray-200">
                  <summary className="cursor-pointer select-none px-3 py-2.5 text-sm font-medium text-gray-700">
                    Ou créer un lot sans fiche produit (à lier plus tard pour générer la commande)
                  </summary>
                  <div className="space-y-4 border-t border-gray-100 p-3">
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
                  </div>
                </details>
              )}

              <div>
                <p className="text-sm font-semibold text-gray-900 mb-2">
                  Prix {selected.length > 1 ? `(identiques pour les ${selected.length} pièces)` : ''}
                </p>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Prix de départ (€)</label>
                    <input
                      type="number" min="0" step="0.01"
                      value={startPrice}
                      onChange={(e) => setStartPrice(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Pas mini. (€)</label>
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
                <p className="mt-2 text-xs text-gray-500">
                  La durée des lots est calée sur la fin de la session — le compte à rebours pourra ensuite être prolongé lot par lot (anti-snipe, +5 min par enchère de dernière minute).
                </p>
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center space-x-2">
                  <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}
            </div>

            <div className="flex justify-end space-x-3 px-6 py-4 border-t border-gray-100 flex-shrink-0">
              <button type="button" onClick={handleClose} disabled={submitting} className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors text-sm disabled:opacity-50">
                Annuler
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 text-sm font-medium"
              >
                {submitting
                  ? `Ajout${progress ? ` ${progress}` : ''}…`
                  : selected.length > 1
                    ? `Ajouter les ${selected.length} pièces`
                    : 'Ajouter la pièce'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default AuctionItemFormModal;
