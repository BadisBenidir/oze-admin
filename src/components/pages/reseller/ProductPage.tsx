import React, { useState } from 'react';
import { Badge } from '../../ui/Badge';
import { useResellerAuth } from '../../../hooks/useResellerAuth';
import { useB2BProduct } from '../../../hooks/useB2BProduct';
import { useB2BCart } from '../../../hooks/useB2BCart';
import { GRADE_VARIANTS, isGrade } from '../../../utils/productGrade';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  ImageOff,
  ShoppingCart,
  Check,
  X,
  Tag,
  ShieldCheck,
  AlertTriangle,
  ZoomIn,
  Clock,
} from 'lucide-react';

interface ProductPageProps {
  productId: string;
  cart: ReturnType<typeof useB2BCart>;
  onBack: () => void;
}

const normalizeImageArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return normalizeImageArray(parsed);
    } catch {
      const inner = value.trim().replace(/^\{/, '').replace(/\}$/, '');
      if (!inner) return [];
      return inner.split(',').map((s) => s.trim().replace(/^"/, '').replace(/"$/, '')).filter(Boolean);
    }
  }
  return [];
};

export const ProductPage: React.FC<ProductPageProps> = ({ productId, cart, onBack }) => {
  const { isReseller } = useResellerAuth();
  const { product, loading, error } = useB2BProduct(productId, isReseller);

  const [activeIndex, setActiveIndex] = useState(0);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="p-4 md:p-6 max-w-6xl mx-auto">
        <div className="h-4 w-32 bg-gray-100 rounded animate-pulse mb-6" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="h-96 bg-gray-100 rounded-lg animate-pulse" />
          <div className="space-y-3">
            <div className="h-4 w-24 bg-gray-100 rounded animate-pulse" />
            <div className="h-7 w-2/3 bg-gray-100 rounded animate-pulse" />
            <div className="h-8 w-32 bg-gray-100 rounded animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !product) {
    return (
      <div className="p-4 md:p-6 max-w-6xl mx-auto text-center py-16">
        <p className="text-gray-500 mb-4">{error || 'Cet article est introuvable ou n\'est plus disponible.'}</p>
        <button onClick={onBack} className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors text-sm">
          Retour au catalogue
        </button>
      </div>
    );
  }

  const images = product.images?.length ? product.images : [];
  const defectImages = normalizeImageArray(product.defect_images);
  const defectLines = (product.defects || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const hasDefects = defectLines.length > 0 || defectImages.length > 0;

  const inCart = cart.isInCart(product.id);
  const goPrev = () => setActiveIndex((i) => (i - 1 + images.length) % images.length);
  const goNext = () => setActiveIndex((i) => (i + 1) % images.length);

  const handleAdd = async () => {
    setAddError(null);
    setAdding(true);
    const result = await cart.addItem(product);
    setAdding(false);
    if (!result.success) {
      setAddError(result.error || "Impossible d'ajouter cet article");
    }
  };

  const buttonDisabled = adding || inCart || (product.held_by_other && !inCart);
  const buttonLabel = adding
    ? 'Ajout en cours...'
    : inCart
    ? 'Dans le panier'
    : product.held_by_other
    ? 'En cours de réservation'
    : 'Ajouter au panier';

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 mb-6">
        <ArrowLeft className="h-4 w-4" />
        <span>Retour au catalogue</span>
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
        {/* Colonne gauche : visuels et transparence */}
        <div>
          <div className="bg-gray-100 rounded-lg overflow-hidden">
            <div className="relative h-80 md:h-96 flex items-center justify-center">
              {images.length > 0 ? (
                <img src={images[activeIndex]} alt={product.name} className="w-full h-full object-cover" />
              ) : (
                <ImageOff className="h-12 w-12 text-gray-300" />
              )}
              {images.length > 1 && (
                <>
                  <button onClick={goPrev} className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 bg-white/90 rounded-full text-gray-700 hover:bg-white shadow">
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button onClick={goNext} className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 bg-white/90 rounded-full text-gray-700 hover:bg-white shadow">
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </>
              )}
            </div>
            {images.length > 1 && (
              <div className="flex gap-2 p-3 overflow-x-auto">
                {images.map((img, i) => (
                  <button
                    key={i}
                    onClick={() => setActiveIndex(i)}
                    className={`h-16 w-16 flex-shrink-0 rounded-md overflow-hidden border-2 transition-colors ${
                      i === activeIndex ? 'border-gray-900' : 'border-transparent'
                    }`}
                  >
                    <img src={img} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Section Imperfections */}
          <div className="mt-6 bg-white border border-gray-100 rounded-lg p-4">
            <p className="text-sm font-semibold text-gray-900 mb-3">Photos et détails des défauts</p>
            {hasDefects ? (
              <div className="space-y-4">
                {defectLines.length > 0 && (
                  <ul className="space-y-1.5">
                    {defectLines.map((line, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-gray-700 bg-red-50/60 border border-red-100 rounded-lg px-3 py-2">
                        <AlertTriangle className="h-3.5 w-3.5 text-red-400 flex-shrink-0 mt-0.5" />
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {defectImages.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {defectImages.map((img, i) => (
                      <button
                        key={i}
                        onClick={() => setZoomedImage(img)}
                        className="relative h-20 w-20 rounded-md overflow-hidden border border-red-200 group"
                      >
                        <img src={img} alt="Défaut" className="w-full h-full object-cover" />
                        <span className="absolute inset-0 bg-black/0 group-hover:bg-black/30 flex items-center justify-center transition-colors">
                          <ZoomIn className="h-4 w-4 text-white opacity-0 group-hover:opacity-100" />
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-100 rounded-lg px-3 py-2">
                <ShieldCheck className="h-4 w-4 flex-shrink-0" />
                <span>Aucun défaut notable sur cette pièce.</span>
              </div>
            )}
          </div>
        </div>

        {/* Colonne droite : informations & achat (sticky) */}
        <div className="lg:sticky lg:top-6 bg-white border border-gray-100 rounded-lg p-6">
          {product.brand?.name && <p className="text-sm font-medium text-gray-500">{product.brand.name}</p>}
          <h1 className="text-2xl font-semibold text-gray-900 mt-0.5">{product.name}</h1>

          <div className="flex items-center flex-wrap gap-2 mt-3">
            {isGrade(product.condition) && (
              <Badge variant={GRADE_VARIANTS[product.condition]} size="md">
                Grade {product.condition}
              </Badge>
            )}
            <span className="inline-flex items-center gap-1 text-xs text-gray-400 font-mono">
              <Tag className="h-3 w-3" />
              {product.b2b_reference || product.reference || product.product_code}
            </span>
          </div>

          <p className="text-3xl font-semibold text-gray-900 mt-4">{product.price.toFixed(0)} €</p>

          {(product.material || (product.colors && product.colors.length > 0)) && (
            <div className="flex flex-wrap gap-2 mt-3 text-xs text-gray-500">
              {product.material && <span className="capitalize">{product.material}</span>}
              {product.colors?.map((c) => (
                <span key={c} className="capitalize">· {c}</span>
              ))}
            </div>
          )}

          {product.description && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <p className="text-sm font-medium text-gray-700 mb-1">Description</p>
              <p className="text-sm text-gray-600 whitespace-pre-line">{product.description}</p>
            </div>
          )}

          {product.held_by_other && !inCart && (
            <div className="mt-4 flex items-center gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <Clock className="h-4 w-4 flex-shrink-0" />
              <span>Cet article est actuellement dans le panier d'un autre revendeur.</span>
            </div>
          )}

          {addError && (
            <div className="mt-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{addError}</div>
          )}

          <button
            onClick={handleAdd}
            disabled={buttonDisabled}
            className={`w-full mt-6 flex items-center justify-center space-x-2 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
              inCart
                ? 'bg-green-50 text-green-700 cursor-default'
                : buttonDisabled
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                : 'bg-gray-900 text-white hover:bg-gray-800'
            }`}
          >
            {inCart ? (
              <>
                <Check className="h-4 w-4" />
                <span>{buttonLabel}</span>
              </>
            ) : (
              <>
                <ShoppingCart className="h-4 w-4" />
                <span>{buttonLabel}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {zoomedImage && (
        <div className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-6" onClick={() => setZoomedImage(null)}>
          <button onClick={() => setZoomedImage(null)} className="absolute top-4 right-4 p-2 bg-white/10 rounded-full text-white hover:bg-white/20">
            <X className="h-5 w-5" />
          </button>
          <img src={zoomedImage} alt="Défaut agrandi" className="max-w-full max-h-full rounded-lg object-contain" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
};
