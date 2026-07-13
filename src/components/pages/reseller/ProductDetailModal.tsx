import React, { useState } from 'react';
import { Badge } from '../../ui/Badge';
import { B2BCatalogItem } from '../../../hooks/useB2BCatalog';
import { ChevronLeft, ChevronRight, ImageOff, ShoppingCart, Check, X, Tag, ShieldCheck, AlertTriangle, ZoomIn } from 'lucide-react';

interface ProductDetailModalProps {
  product: B2BCatalogItem;
  inCart: boolean;
  onClose: () => void;
  onAdd: () => void;
}

export const GRADE_VARIANTS: Record<string, 'success' | 'info' | 'warning' | 'default'> = {
  S: 'success',
  A: 'success',
  AB: 'info',
  B: 'info',
  BC: 'warning',
  C: 'warning',
  D: 'default',
};

export const isGrade = (condition: string) => Object.prototype.hasOwnProperty.call(GRADE_VARIANTS, condition);

export const ProductDetailModal: React.FC<ProductDetailModalProps> = ({ product, inCart, onClose, onAdd }) => {
  const images = product.images?.length ? product.images : [];
  const defectImages = product.defect_images?.length ? product.defect_images : [];
  const defectLines = (product.defects || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const hasDefects = defectLines.length > 0 || defectImages.length > 0;

  const [activeIndex, setActiveIndex] = useState(
    Math.min(product.main_image_index || 0, Math.max(images.length - 1, 0))
  );
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);

  const goPrev = () => setActiveIndex((i) => (i - 1 + images.length) % images.length);
  const goNext = () => setActiveIndex((i) => (i + 1) % images.length);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black bg-opacity-50" onClick={onClose} />

      <div className="flex items-start md:items-center justify-center min-h-full p-4">
        <div
          className="relative bg-white rounded-lg shadow-xl w-full max-w-4xl mx-auto overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={onClose}
            className="absolute top-3 right-3 z-10 p-1.5 bg-white/90 rounded-full text-gray-500 hover:text-gray-900 shadow"
          >
            <X className="h-5 w-5" />
          </button>

          <div className="grid grid-cols-1 md:grid-cols-2">
            {/* Galerie photos */}
            <div className="bg-gray-100">
              <div className="relative h-72 md:h-full min-h-[320px] flex items-center justify-center">
                {images.length > 0 ? (
                  <img src={images[activeIndex]} alt={product.name} className="w-full h-full object-cover" />
                ) : (
                  <ImageOff className="h-12 w-12 text-gray-300" />
                )}

                {images.length > 1 && (
                  <>
                    <button
                      onClick={goPrev}
                      className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 bg-white/90 rounded-full text-gray-700 hover:bg-white shadow"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <button
                      onClick={goNext}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 bg-white/90 rounded-full text-gray-700 hover:bg-white shadow"
                    >
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
                      className={`h-14 w-14 flex-shrink-0 rounded-md overflow-hidden border-2 transition-colors ${
                        i === activeIndex ? 'border-gray-900' : 'border-transparent'
                      }`}
                    >
                      <img src={img} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}

              {defectImages.length > 0 && (
                <div className="px-3 pb-3">
                  <p className="text-xs font-medium text-gray-500 mb-2 flex items-center gap-1">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Photos des imperfections
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {defectImages.map((img, i) => (
                      <button
                        key={i}
                        onClick={() => setZoomedImage(img)}
                        className="relative h-16 w-16 rounded-md overflow-hidden border border-red-200 group"
                      >
                        <img src={img} alt="Défaut" className="w-full h-full object-cover" />
                        <span className="absolute inset-0 bg-black/0 group-hover:bg-black/30 flex items-center justify-center transition-colors">
                          <ZoomIn className="h-4 w-4 text-white opacity-0 group-hover:opacity-100" />
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Informations */}
            <div className="p-6 flex flex-col max-h-[80vh] md:max-h-none overflow-y-auto">
              {product.brand?.name && (
                <p className="text-sm font-medium text-gray-500">{product.brand.name}</p>
              )}
              <h2 className="text-xl font-semibold text-gray-900 mt-0.5">{product.name}</h2>

              <div className="flex items-center flex-wrap gap-2 mt-3">
                {isGrade(product.condition) && (
                  <Badge variant={GRADE_VARIANTS[product.condition]} size="md">
                    Grade {product.condition}
                  </Badge>
                )}
                <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                  <Tag className="h-3 w-3" />
                  {product.reference || product.product_code}
                </span>
              </div>

              <p className="text-2xl font-semibold text-gray-900 mt-4">{product.price.toFixed(0)} €</p>

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

              <div className="mt-4 pt-4 border-t border-gray-100">
                <p className="text-sm font-medium text-gray-700 mb-2">État & transparence</p>
                {hasDefects ? (
                  defectLines.length > 0 ? (
                    <ul className="space-y-1.5">
                      {defectLines.map((line, i) => (
                        <li
                          key={i}
                          className="flex items-start gap-2 text-sm text-gray-700 bg-red-50/60 border border-red-100 rounded-lg px-3 py-2"
                        >
                          <AlertTriangle className="h-3.5 w-3.5 text-red-400 flex-shrink-0 mt-0.5" />
                          <span>{line}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-gray-500">Voir les photos des imperfections ci-contre.</p>
                  )
                ) : (
                  <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-100 rounded-lg px-3 py-2">
                    <ShieldCheck className="h-4 w-4 flex-shrink-0" />
                    <span>Aucun défaut notable sur cette pièce.</span>
                  </div>
                )}
              </div>

              <div className="mt-auto pt-6">
                <button
                  onClick={onAdd}
                  disabled={inCart}
                  className={`w-full flex items-center justify-center space-x-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    inCart ? 'bg-green-50 text-green-700 cursor-default' : 'bg-gray-900 text-white hover:bg-gray-800'
                  }`}
                >
                  {inCart ? (
                    <>
                      <Check className="h-4 w-4" />
                      <span>Dans le panier</span>
                    </>
                  ) : (
                    <>
                      <ShoppingCart className="h-4 w-4" />
                      <span>Ajouter au panier</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {zoomedImage && (
        <div
          className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-6"
          onClick={() => setZoomedImage(null)}
        >
          <button
            onClick={() => setZoomedImage(null)}
            className="absolute top-4 right-4 p-2 bg-white/10 rounded-full text-white hover:bg-white/20"
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={zoomedImage}
            alt="Défaut agrandi"
            className="max-w-full max-h-full rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
};
