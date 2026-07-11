import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Modal } from '../ui/Modal';
import { Search, X, Check, Upload } from 'lucide-react';

interface BrandOption { id: string; name: string }
interface CategoryOption { id: string; name: string }

interface LiveProductFormProps {
  isOpen: boolean;
  onClose: () => void;
  /** Id du produit à modifier ; absent = création. */
  productId?: string | null;
  /** Appelé après création/modification réussie (pour rafraîchir la liste). */
  onSaved: (info: { name: string; reference: string | null; edited: boolean }) => void;
}

// Grille d'état pour les articles Live enchères.
export const LIVE_CONDITIONS = ['A', 'AB', 'B', 'BC', 'C', 'D'] as const;

const parseAmount = (v: string): number => {
  const n = parseFloat((v || '').replace(',', '.'));
  return isNaN(n) ? NaN : n;
};

/**
 * Formulaire SIMPLIFIÉ de création / modification d'un article Live enchères.
 * Champs : titre, marque, catégorie, état (A/AB/B/BC/C/D), prix d'achat, photos.
 * Pas de prix de vente (saisi à la vente), ni genre/matière/couleur/description.
 */
export const LiveProductForm: React.FC<LiveProductFormProps> = ({ isOpen, onClose, productId, onSaved }) => {
  const isEdit = Boolean(productId);

  const [brands, setBrands] = useState<BrandOption[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);

  const [name, setName] = useState('');
  const [brandId, setBrandId] = useState('');
  const [brandSearch, setBrandSearch] = useState('');
  const [showBrandDropdown, setShowBrandDropdown] = useState(false);
  const [categoryId, setCategoryId] = useState('');
  const [condition, setCondition] = useState<string>('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [mainImageIndex, setMainImageIndex] = useState(0);

  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingProduct, setLoadingProduct] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const brandRef = useRef<HTMLDivElement>(null);

  // Chargement marques + catégories à l'ouverture.
  useEffect(() => {
    if (!isOpen) return;
    (async () => {
      const [b, c] = await Promise.all([
        supabase.from('brands').select('id, name').order('name', { ascending: true }),
        supabase.from('categories').select('id, name').order('name', { ascending: true }),
      ]);
      setBrands((b.data as BrandOption[]) || []);
      setCategories((c.data as CategoryOption[]) || []);
    })();
  }, [isOpen]);

  // (Ré)initialise ou pré-remplit le formulaire à l'ouverture.
  useEffect(() => {
    if (!isOpen) return;
    setError(null); setSaving(false); setShowBrandDropdown(false);

    if (productId) {
      setLoadingProduct(true);
      (async () => {
        const { data, error } = await supabase
          .from('products')
          .select('name, brand_id, category_id, condition, purchase_price, images, main_image_index, brand:brands(name)')
          .eq('id', productId)
          .single();
        if (error || !data) {
          setError("Impossible de charger l'article.");
          setLoadingProduct(false);
          return;
        }
        setName(data.name || '');
        setBrandId(data.brand_id || '');
        setBrandSearch((data as any).brand?.name || '');
        setCategoryId(data.category_id || '');
        setCondition(data.condition || '');
        setPurchasePrice(data.purchase_price != null ? String(data.purchase_price) : '');
        setImages(data.images || []);
        setMainImageIndex(data.main_image_index || 0);
        setLoadingProduct(false);
      })();
    } else {
      setName(''); setBrandId(''); setBrandSearch(''); setCategoryId('');
      setCondition(''); setPurchasePrice(''); setImages([]); setMainImageIndex(0);
    }
  }, [isOpen, productId]);

  // Fermer le dropdown marque au clic extérieur.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (brandRef.current && !brandRef.current.contains(e.target as Node)) setShowBrandDropdown(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const filteredBrands = brandSearch.length >= 1
    ? brands.filter((b) => b.name.toLowerCase().includes(brandSearch.toLowerCase())).slice(0, 30)
    : [];

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const imageFiles = Array.from(files).filter((f) => f.type.startsWith('image/') && f.size <= 10 * 1024 * 1024);
    if (imageFiles.length === 0) return;
    setUploading(true);
    try {
      const urls: string[] = [];
      for (const file of imageFiles) {
        const ext = file.name.split('.').pop();
        const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}.${ext}`;
        const { error: upErr } = await supabase.storage.from('products-images').upload(fileName, file, { cacheControl: '3600', upsert: false });
        if (upErr) { console.error('Upload échoué:', upErr); continue; }
        const { data: { publicUrl } } = supabase.storage.from('products-images').getPublicUrl(fileName);
        urls.push(publicUrl);
      }
      if (urls.length) setImages((prev) => [...prev, ...urls]);
    } finally {
      setUploading(false);
    }
  };

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
    setMainImageIndex((mi) => (index === mi ? 0 : index < mi ? mi - 1 : mi));
  };

  const canSubmit =
    !!name.trim() && !!brandId && !!categoryId && !!condition &&
    !isNaN(parseAmount(purchasePrice)) && parseAmount(purchasePrice) >= 0 && !uploading;

  const handleSubmit = async () => {
    setError(null);
    if (!name.trim()) return setError('Le titre est obligatoire.');
    if (!brandId) return setError('Sélectionne une marque.');
    if (!categoryId) return setError('Sélectionne une catégorie.');
    if (!condition) return setError("Sélectionne l'état.");
    const price = parseAmount(purchasePrice);
    if (isNaN(price) || price < 0) return setError("Saisis un prix d'achat valide.");

    setSaving(true);
    const base = {
      name: name.trim(),
      brand_id: brandId,
      category_id: categoryId,
      condition,
      purchase_price: price,
      images,
      main_image_index: images.length ? Math.min(mainImageIndex, images.length - 1) : 0,
    };

    let resData: any = null;
    let resError: any = null;
    if (productId) {
      // Modification : ne touche pas au statut ni au prix de vente.
      const r = await supabase.from('products').update(base).eq('id', productId).select('name, reference').single();
      resData = r.data; resError = r.error;
    } else {
      const r = await supabase.from('products').insert([{
        ...base,
        sale_price: 0,            // pas de prix de vente : saisi à la vente
        genre: null,
        status: 'for-auction-live',
        colors: [],
        defect_images: [],
      }]).select('name, reference').single();
      resData = r.data; resError = r.error;
    }
    setSaving(false);

    if (resError) {
      setError(`${productId ? 'Modification' : 'Création'} impossible : ${resError.message}`);
      return;
    }
    onSaved({ name: resData?.name || name.trim(), reference: resData?.reference ?? null, edited: isEdit });
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => { if (!saving && !uploading) onClose(); }}
      title={isEdit ? "Modifier l'article Live" : 'Nouvel article Live enchères'}
    >
      {loadingProduct ? (
        <div className="py-10 text-center text-gray-500 text-sm">Chargement…</div>
      ) : (
      <div className="space-y-4">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
        )}

        {/* Titre */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Titre *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="Ex: Sac Hermès Kelly 28"
            autoFocus
          />
        </div>

        {/* Marque (recherche) */}
        <div ref={brandRef}>
          <label className="block text-sm font-medium text-gray-700 mb-1">Marque *</label>
          <div className="relative">
            <input
              type="text"
              value={brandSearch}
              onChange={(e) => { setBrandSearch(e.target.value); setShowBrandDropdown(true); if (!e.target.value) setBrandId(''); }}
              onFocus={() => brandSearch && !brandId && setShowBrandDropdown(true)}
              className="w-full px-3 py-2 pr-8 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Rechercher une marque..."
            />
            <div className="absolute inset-y-0 right-0 flex items-center pr-3">
              {brandId ? (
                <button type="button" onClick={() => { setBrandId(''); setBrandSearch(''); }} className="text-gray-400 hover:text-gray-600">
                  <X className="h-4 w-4" />
                </button>
              ) : (
                <Search className="h-4 w-4 text-gray-400" />
              )}
            </div>
            {showBrandDropdown && filteredBrands.length > 0 && !brandId && (
              <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-48 overflow-y-auto">
                {filteredBrands.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => { setBrandId(b.id); setBrandSearch(b.name); setShowBrandDropdown(false); }}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
                  >
                    {b.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Catégorie */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Catégorie *</label>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">Sélectionner une catégorie</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        {/* État (grille A-D) */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">État *</label>
          <div className="flex flex-wrap gap-2">
            {LIVE_CONDITIONS.map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setCondition(g)}
                className={`min-w-[3rem] px-3 py-2 rounded-md border text-sm font-semibold transition-colors ${
                  condition === g
                    ? 'bg-indigo-600 border-indigo-600 text-white'
                    : 'bg-white border-gray-300 text-gray-700 hover:border-indigo-400'
                }`}
              >
                {g}
              </button>
            ))}
          </div>
        </div>

        {/* Prix d'achat */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Prix d'achat (€) *</label>
          <input
            type="text"
            inputMode="decimal"
            value={purchasePrice}
            onChange={(e) => setPurchasePrice(e.target.value.replace(/[^0-9.,]/g, ''))}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="Ex: 800"
          />
          <p className="mt-1 text-xs text-gray-500">Pas de prix de vente : il sera saisi au moment de la vente (« Marquer comme vendu »).</p>
        </div>

        {/* Photos */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Photos</label>
          <input
            type="file"
            id="live-image-upload"
            multiple
            accept="image/*"
            className="hidden"
            disabled={uploading}
            onChange={(e) => handleUpload(e.target.files)}
          />
          <label
            htmlFor="live-image-upload"
            className={`flex items-center justify-center gap-2 border-2 border-dashed rounded-lg p-4 text-sm transition-colors ${
              uploading ? 'border-indigo-300 bg-indigo-50 cursor-wait text-indigo-600' : 'border-gray-300 hover:border-indigo-400 cursor-pointer text-gray-600'
            }`}
          >
            <Upload className="h-4 w-4" />
            {uploading ? 'Upload en cours…' : 'Ajouter des photos (JPG/PNG, max 10 Mo)'}
          </label>

          {images.length > 0 && (
            <>
              <p className="mt-2 text-xs text-gray-500">Clique sur une photo pour la définir comme principale.</p>
              <div className="mt-2 grid grid-cols-3 sm:grid-cols-4 gap-2">
                {images.map((url, i) => (
                  <div key={i} className="relative group">
                    <div
                      onClick={() => setMainImageIndex(i)}
                      className={`aspect-square rounded-lg overflow-hidden border-2 cursor-pointer ${i === mainImageIndex ? 'border-indigo-500 ring-2 ring-indigo-200' : 'border-gray-200'}`}
                    >
                      <img src={url} alt={`photo ${i + 1}`} className="w-full h-full object-cover" />
                    </div>
                    {i === mainImageIndex && (
                      <span className="absolute -top-2 -left-2 bg-indigo-600 text-white text-[10px] px-1.5 py-0.5 rounded">Principale</span>
                    )}
                    <button
                      type="button"
                      onClick={() => removeImage(i)}
                      className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Retirer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving || uploading}
            className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving || !canSubmit}
            className="flex items-center gap-1 px-4 py-2 text-sm text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50"
          >
            <Check className="h-4 w-4" />
            {saving ? 'Enregistrement...' : isEdit ? 'Enregistrer' : "Créer l'article"}
          </button>
        </div>
      </div>
      )}
    </Modal>
  );
};