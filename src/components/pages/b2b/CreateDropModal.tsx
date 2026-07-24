import React, { useEffect, useMemo, useState } from 'react';
import { X, Search, Package, AlertCircle } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { Drop, DropInput } from '../../../hooks/useDrops';

interface DraftProduct {
  id: string;
  name: string;
  product_code: string;
  sale_price: number;
  images: string[];
  main_image_index: number;
  brand: { name: string } | null;
}

interface CreateDropModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (input: DropInput) => Promise<{ success: boolean; error?: string }>;
  /** Présent en mode édition : pré-remplit le formulaire avec ce drop existant. */
  editingDrop?: Drop | null;
}

// Format attendu par <input type="datetime-local"> : "YYYY-MM-DDTHH:mm", en heure locale.
const toDatetimeLocalValue = (iso: string): string => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const CreateDropModal: React.FC<CreateDropModalProps> = ({ isOpen, onClose, onSubmit, editingDrop }) => {
  const [products, setProducts] = useState<DraftProduct[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');

  const [title, setTitle] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    if (!isOpen) return;

    setTitle(editingDrop?.title || '');
    setScheduledAt(editingDrop ? toDatetimeLocalValue(editingDrop.scheduled_at) : '');
    setSelectedIds(new Set(editingDrop?.product_ids || []));
    setFormError('');
    setSearch('');
  }, [isOpen, editingDrop]);

  useEffect(() => {
    if (!isOpen) return;

    const loadDraftProducts = async () => {
      setLoadingProducts(true);
      setLoadError('');
      try {
        // En édition, les articles déjà sélectionnés peuvent avoir été
        // basculés hors 'draft' entre-temps par un autre drop : on les
        // inclut quand même pour ne pas les faire disparaître de la liste.
        const preselected = editingDrop?.product_ids || [];
        const { data, error } = await supabase
          .from('products')
          .select('id, name, product_code, sale_price, images, main_image_index, brand:brands(name)')
          .or(
            preselected.length > 0
              ? `status.eq.draft,id.in.(${preselected.join(',')})`
              : 'status.eq.draft'
          )
          .order('created_at', { ascending: false });

        if (error) throw new Error(error.message);
        setProducts((data || []) as unknown as DraftProduct[]);
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : 'Erreur de chargement des articles');
      } finally {
        setLoadingProducts(false);
      }
    };

    loadDraftProducts();
  }, [isOpen, editingDrop]);

  const filteredProducts = useMemo(() => {
    if (!search.trim()) return products;
    const term = search.toLowerCase();
    return products.filter(
      (p) => p.name.toLowerCase().includes(term) || p.product_code.toLowerCase().includes(term)
    );
  }, [products, search]);

  const toggleProduct = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (selectedIds.size === 0) {
      setFormError('Sélectionne au moins un article');
      return;
    }
    if (!scheduledAt) {
      setFormError('Choisis une date et une heure de lancement');
      return;
    }
    const scheduledIso = new Date(scheduledAt).toISOString();
    if (!editingDrop && new Date(scheduledIso).getTime() <= Date.now()) {
      setFormError('La date de lancement doit être dans le futur');
      return;
    }

    setSubmitting(true);
    const result = await onSubmit({
      title: title.trim() || undefined,
      scheduled_at: scheduledIso,
      product_ids: [...selectedIds],
    });
    setSubmitting(false);

    if (!result.success) {
      setFormError(result.error || 'Erreur lors de la planification');
      return;
    }
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black bg-opacity-50" onClick={onClose} />

      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between p-6 border-b border-gray-100 flex-shrink-0">
            <h3 className="text-lg font-semibold text-gray-900">{editingDrop ? 'Modifier le drop' : 'Créer un Drop'}</h3>
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded-lg transition-colors">
              <X className="h-5 w-5" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
            <div className="p-6 space-y-4 overflow-y-auto flex-1">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="drop-title" className="block text-sm font-medium text-gray-700 mb-2">
                    Nom du drop (optionnel)
                  </label>
                  <input
                    id="drop-title"
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Ex : Drop sacs été"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-400 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="drop-datetime" className="block text-sm font-medium text-gray-700 mb-2">
                    Date &amp; heure de lancement
                  </label>
                  <input
                    id="drop-datetime"
                    type="datetime-local"
                    required
                    value={scheduledAt}
                    onChange={(e) => setScheduledAt(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-400 text-sm"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-gray-700">
                    Articles en brouillon ({selectedIds.size} sélectionné{selectedIds.size > 1 ? 's' : ''})
                  </label>
                </div>
                <div className="relative mb-2">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Rechercher par nom ou code..."
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

                <div className="border border-gray-200 rounded-lg max-h-64 overflow-y-auto divide-y divide-gray-100">
                  {loadingProducts ? (
                    [...Array(3)].map((_, i) => (
                      <div key={i} className="p-3">
                        <div className="h-10 bg-gray-100 rounded-lg animate-pulse" />
                      </div>
                    ))
                  ) : filteredProducts.length === 0 ? (
                    <div className="p-6 text-center text-sm text-gray-500">
                      Aucun article en brouillon{search ? ' pour cette recherche' : ''}.
                    </div>
                  ) : (
                    filteredProducts.map((product) => {
                      const checked = selectedIds.has(product.id);
                      return (
                        <label
                          key={product.id}
                          className={`flex items-center gap-3 p-3 cursor-pointer transition-colors ${checked ? 'bg-gray-50' : 'hover:bg-gray-50'}`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleProduct(product.id)}
                            className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-900"
                          />
                          <div className="h-9 w-9 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden">
                            {product.images?.length > 0 ? (
                              <img
                                src={product.images[product.main_image_index] || product.images[0]}
                                alt={product.name}
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <Package className="h-4 w-4 text-gray-400" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-gray-900 truncate">{product.name}</p>
                            <p className="text-xs text-gray-500">{product.brand?.name || 'Sans marque'} · {product.sale_price.toFixed(0)} €</p>
                          </div>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>

              {formError && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center space-x-2">
                  <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
                  <p className="text-sm text-red-700">{formError}</p>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 p-6 pt-4 border-t border-gray-100 flex-shrink-0">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors text-sm"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 text-sm font-medium"
              >
                {submitting ? 'Enregistrement...' : editingDrop ? 'Enregistrer' : 'Planifier le drop'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
