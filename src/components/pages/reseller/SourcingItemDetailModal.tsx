import React, { useEffect, useState } from 'react';
import { Badge } from '../../ui/Badge';
import { ResellerSourcingItem } from '../../../hooks/useResellerSourcing';
import { GRADE_VARIANTS, isGrade } from '../../../utils/productGrade';
import { X, ChevronLeft, ChevronRight, ImageOff, AlertTriangle, ZoomIn } from 'lucide-react';

interface SourcingItemDetailModalProps {
  item: ResellerSourcingItem | null;
  onClose: () => void;
}

// Même mapping que ProductDetail.tsx/Products.tsx (admin) — condition
// couvre deux vocabulaires distincts sur products.condition : des grades
// lettrés (S/A/AB/B/BC/C/D, voir isGrade) ET des libellés texte
// (neuf/excellent/very-good/good/fair). Les deux doivent être affichés,
// pas seulement les grades — cas réel qui masquait l'état pour toute pièce
// dont la fiche produit liée utilisait ce second vocabulaire.
const formatCondition = (condition: string): string => {
  switch (condition) {
    case 'neuf': return 'Neuf';
    case 'excellent': return 'Excellent';
    case 'very-good': return 'Très bon';
    case 'good': return 'Bon';
    case 'fair': return 'Correct';
    case 'S': case 'A': case 'AB': case 'B': case 'BC': case 'C': case 'D':
      return `Grade ${condition}`;
    default: return condition;
  }
};

const itemStatusBadge = (status: ResellerSourcingItem['status']) => {
  switch (status) {
    case 'validated':
      return <Badge variant="info">Validée</Badge>;
    case 'shipped':
      return <Badge variant="success">Expédiée</Badge>;
    default:
      return <Badge variant="default">Sourcé / Prévu dans votre lot</Badge>;
  }
};

// Même normalisation que ProductPage.tsx : defect_images peut arriver en
// tableau JS, en JSON stringifié, ou en syntaxe Postgres text[] brute selon
// le chemin de lecture — jamais fait confiance à une seule forme.
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

/** Fiche détail d'une pièce sourcée, façon fiche produit du catalogue —
 * jamais aucun prix ici (photos, marque, catégorie, grade, matière,
 * couleurs, n° de série, description, défauts) : voir
 * 0097_reseller_sourcing_item_detail.sql, qui exclut structurellement
 * purchase_price/cost_price/billed_price de la vue source. */
export const SourcingItemDetailModal: React.FC<SourcingItemDetailModalProps> = ({ item, onClose }) => {
  const [activeIndex, setActiveIndex] = useState(0);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);

  useEffect(() => {
    setActiveIndex(0);
    setZoomedImage(null);
  }, [item?.id]);

  if (!item) return null;

  const images = item.photos || [];
  const defectImages = normalizeImageArray(item.defect_images);
  const defectLines = (item.defects || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const hasDefects = defectLines.length > 0 || defectImages.length > 0;

  const goPrev = () => setActiveIndex((i) => (i - 1 + images.length) % images.length);
  const goNext = () => setActiveIndex((i) => (i + 1) % images.length);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black bg-opacity-50" onClick={onClose} />
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
          <button onClick={onClose} className="absolute top-4 right-4 p-1.5 text-gray-500 hover:text-gray-900 bg-white/90 rounded-full shadow z-10 transition-colors">
            <X className="h-5 w-5" />
          </button>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-6">
            {/* Galerie */}
            <div>
              <div className="bg-gray-100 rounded-lg overflow-hidden">
                <div className="relative h-72 md:h-96 flex items-center justify-center">
                  {images.length > 0 ? (
                    <img src={images[activeIndex]} alt={item.title} className="w-full h-full object-cover" />
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

              {hasDefects && (
                <div className="mt-4 bg-gray-50 border border-gray-100 rounded-lg p-4">
                  <p className="text-sm font-semibold text-gray-900 mb-3">Photos et détails des défauts</p>
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
                </div>
              )}
            </div>

            {/* Informations */}
            <div>
              {item.brand && <p className="text-sm font-medium text-gray-500">{item.brand}</p>}
              <h2 className="text-xl font-semibold text-gray-900 mt-0.5">{item.title}</h2>

              <div className="flex items-center flex-wrap gap-2 mt-3">
                {item.condition && (
                  <Badge variant={isGrade(item.condition) ? GRADE_VARIANTS[item.condition] : 'default'}>
                    État : {formatCondition(item.condition)}
                  </Badge>
                )}
                {item.category_name && <Badge variant="default">{item.category_name}</Badge>}
                {itemStatusBadge(item.status)}
              </div>

              {(item.material || (item.colors && item.colors.length > 0) || item.serial_number) && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {item.material && (
                    <span className="text-xs text-gray-600 bg-gray-100 rounded-full px-2.5 py-1 capitalize">
                      <span className="text-gray-400">Matière :</span> {item.material}
                    </span>
                  )}
                  {item.colors && item.colors.length > 0 && (
                    <span className="text-xs text-gray-600 bg-gray-100 rounded-full px-2.5 py-1 capitalize">
                      <span className="text-gray-400">Couleur :</span> {item.colors.join(', ')}
                    </span>
                  )}
                  {item.serial_number && (
                    <span className="text-xs text-gray-600 bg-gray-100 rounded-full px-2.5 py-1 font-mono">
                      <span className="text-gray-400 font-sans">N° série :</span> {item.serial_number}
                    </span>
                  )}
                </div>
              )}

              {item.description && (
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <p className="text-sm font-medium text-gray-700 mb-1">Description</p>
                  <p className="text-sm text-gray-600 whitespace-pre-line">{item.description}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {zoomedImage && (
        <div className="fixed inset-0 z-[70] bg-black/80 flex items-center justify-center p-6" onClick={() => setZoomedImage(null)}>
          <button onClick={() => setZoomedImage(null)} className="absolute top-4 right-4 p-2 bg-white/10 rounded-full text-white hover:bg-white/20">
            <X className="h-5 w-5" />
          </button>
          <img src={zoomedImage} alt="Défaut agrandi" className="max-w-full max-h-full rounded-lg object-contain" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
};

export default SourcingItemDetailModal;
