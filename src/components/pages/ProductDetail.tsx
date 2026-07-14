import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Product } from '../../hooks/useProducts';
import { useAdminAuth } from '../../hooks/useAdminAuth';
import { ProductLabel } from '../products/ProductLabel';
import { BarcodeScanner } from '../products/BarcodeScanner';
import { Modal } from '../ui/Modal';
import { validateProductByBarcode } from '../../services/productValidationService';
import {
  ArrowLeft,
  Package,
  Calendar,
  Tag,
  Palette,
  Weight,
  Eye,
  Edit,
  Trash2,
  ChevronLeft,
  ChevronRight,
  ScanLine,
  AlertTriangle,
  ZoomIn,
  X
} from 'lucide-react';

interface ProductDetailProps {
  productId: string;
  onBack: () => void;
  onEdit?: (productId: string) => void;
  onProductUpdate?: () => void; // Callback pour actualiser la liste
}

export const ProductDetail: React.FC<ProductDetailProps> = ({ productId, onBack, onEdit, onProductUpdate }) => {
  const { isAdmin } = useAdminAuth();
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [zoomedDefectImage, setZoomedDefectImage] = useState<string | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [statusUpdateSuccess, setStatusUpdateSuccess] = useState(false);

  // Validation par scan (mise en ligne après lecture du code-barres)
  const [showScanModal, setShowScanModal] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const handleScanValidate = async (code: string) => {
    if (!product) return;
    // Le code scanné doit correspondre à l'article affiché.
    if (product.barcode && code.trim().toUpperCase() !== product.barcode.toUpperCase()) {
      setScanError(`Ce code (${code}) ne correspond pas à cet article (${product.barcode}).`);
      return;
    }
    const outcome = await validateProductByBarcode(code);
    if (outcome.status === 'validated' || outcome.status === 'already-online') {
      setProduct({ ...product, status: 'for-sale-online' });
      setShowScanModal(false);
      setScanError(null);
      onProductUpdate?.();
    } else if (outcome.status === 'no-photos') {
      setScanError('Ajoute au moins une photo à cet article avant de le mettre en ligne.');
    } else if (outcome.status === 'no-price') {
      setScanError('Renseigne un prix de vente avant de mettre cet article en ligne.');
    } else if (outcome.status === 'not-found') {
      setScanError('Référence inconnue en base.');
    } else if (outcome.status === 'error') {
      setScanError(outcome.message);
    }
  };

  useEffect(() => {
    const fetchProduct = async () => {
      if (!isAdmin) return;
      
      try {
        setLoading(true);
        setError(null);
        
        const { supabase } = await import('../../lib/supabase');
        
        const { data, error: fetchError } = await supabase
          .from('products')
          .select(`
            *,
            brand:brands(id, name),
            category:categories(id, name)
          `)
          .eq('id', productId)
          .single();

        if (fetchError) {
          throw new Error(fetchError.message);
        }

        setProduct(data);
        
      } catch (err) {
        console.error('Erreur lors du chargement du produit:', err);
        setError(err instanceof Error ? err.message : 'Erreur inconnue');
      } finally {
        setLoading(false);
      }
    };

    fetchProduct();
  }, [productId, isAdmin]);

  const nextImage = () => {
    if (product && product.images.length > 1) {
      setCurrentImageIndex((prev) => 
        prev === product.images.length - 1 ? 0 : prev + 1
      );
    }
  };

  const previousImage = () => {
    if (product && product.images.length > 1) {
      setCurrentImageIndex((prev) => 
        prev === 0 ? product.images.length - 1 : prev - 1
      );
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    if (!product || !isAdmin || updatingStatus) return;
    
    try {
      setUpdatingStatus(true);
      
      const { supabase } = await import('../../lib/supabase');
      
      const { error } = await supabase
        .from('products')
        .update({ status: newStatus })
        .eq('id', productId);

      if (error) {
        throw new Error(error.message);
      }

      // Mettre à jour l'état local
      setProduct(prev => prev ? { ...prev, status: newStatus as any } : null);
      
      // Afficher le message de succès
      setStatusUpdateSuccess(true);
      setTimeout(() => setStatusUpdateSuccess(false), 2000);
      
      // Actualiser la liste des produits après un petit délai
      if (onProductUpdate) {
        setTimeout(() => onProductUpdate(), 500);
      }
      
    } catch (error) {
      console.error('Erreur lors de la mise à jour du statut:', error);
      alert('Erreur lors de la mise à jour du statut');
    } finally {
      setUpdatingStatus(false);
    }
  };

  const formatCondition = (condition: string) => {
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

  const formatStatus = (status: string) => {
    switch (status) {
      case 'draft': return 'Brouillon';
      case 'for-sale-online': return 'À vendre en ligne';
      case 'for-sale-other-platform': return 'À vendre sur autre plateforme';
      case 'for-sale-b2b': return 'Revendeurs B2B uniquement';
      case 'reserved-b2b': return 'Réservé (B2B)';
      case 'sold-b2b': return 'Vendu (B2B)';
      case 'sold-online': return 'Vendu en ligne';
      case 'sold-other-platform': return 'Vendu sur autre plateforme';
      case 'sold-display': return 'Vendu - Affiché';
      default: return status;
    }
  };

  const formatGenre = (genre: string) => {
    switch (genre) {
      case 'femme': return 'Femme';
      case 'homme': return 'Homme';
      case 'fille': return 'Fille';
      case 'garcon': return 'Garçon';
      default: return genre;
    }
  };

  if (loading) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <div className="animate-pulse">
          <div className="h-8 w-48 bg-gray-200 rounded mb-8"></div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="h-96 bg-gray-200 rounded-lg"></div>
            <div className="space-y-4">
              <div className="h-8 w-3/4 bg-gray-200 rounded"></div>
              <div className="h-6 w-1/2 bg-gray-200 rounded"></div>
              <div className="h-32 bg-gray-200 rounded"></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !product) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <button
          onClick={onBack}
          className="flex items-center text-gray-600 hover:text-gray-800 mb-4"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour à la liste
        </button>
        <div className="text-center py-12">
          <Package className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Produit non trouvé</h3>
          <p className="text-gray-500">{error || 'Ce produit n\'existe pas ou n\'est plus disponible.'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      {/* En-tête */}
      <div className="mb-8">
        <button
          onClick={onBack}
          className="flex items-center text-gray-600 hover:text-gray-800 mb-4 transition-colors touch-manipulation min-h-[44px]"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          <span className="text-sm md:text-base">Retour à la liste des produits</span>
        </button>
        
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between space-y-4 lg:space-y-0">
          <div className="flex-1">
            <div className="flex flex-col sm:flex-row sm:items-center space-y-2 sm:space-y-0 sm:space-x-3 mb-2">
              <h1 className="text-xl md:text-2xl font-bold text-gray-900">{product.name}</h1>
              <Badge variant={
                product.status === 'for-sale-online' || product.status === 'for-sale-b2b' ? 'success' :
                product.status === 'sold-online' || product.status === 'sold-other-platform' || product.status === 'sold-b2b' ? 'warning' :
                product.status === 'sold-display' || product.status === 'reserved-b2b' ? 'info' :
                product.status === 'draft' ? 'default' : 'info'
              }>
                {formatStatus(product.status)}
              </Badge>
            </div>
            <p className="text-gray-600">{product.brand?.name || 'Sans marque'} • {product.product_code}</p>
            {product.b2b_reference && (
              <p className="text-sm text-gray-500 font-mono mt-1">SKU B2B : {product.b2b_reference}</p>
            )}
          </div>
          
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 lg:flex-shrink-0">
            {product.status === 'draft' && (
              <button
                onClick={() => { setScanError(null); setShowScanModal(true); }}
                className="flex items-center justify-center px-4 py-3 md:py-2 text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors touch-manipulation text-sm"
              >
                <ScanLine className="h-4 w-4 mr-2" />
                Valider par scan
              </button>
            )}
            {onEdit && (
              <button
                onClick={() => onEdit(productId)}
                className="flex items-center justify-center px-4 py-3 md:py-2 text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors touch-manipulation text-sm"
              >
                <Edit className="h-4 w-4 mr-2" />
                Modifier
              </button>
            )}
            <button className="flex items-center justify-center px-4 py-3 md:py-2 text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors touch-manipulation text-sm">
              <Trash2 className="h-4 w-4 mr-2" />
              Supprimer
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8">
        {/* Galerie d'images */}
        <div className="space-y-4">
          <Card>
            <CardContent className="p-4">
              {product.images.length > 0 ? (
                <div className="space-y-4">
                  {/* Image principale */}
                  <div className="relative aspect-square bg-gray-50 rounded-lg overflow-hidden">
                    <img
                      src={product.images[currentImageIndex]}
                      alt={product.name}
                      className="w-full h-full object-cover"
                    />
                    
                    {product.images.length > 1 && (
                      <>
                        <button
                          onClick={previousImage}
                          className="absolute left-2 top-1/2 transform -translate-y-1/2 bg-black bg-opacity-50 text-white p-3 md:p-2 rounded-full hover:bg-opacity-75 touch-manipulation"
                        >
                          <ChevronLeft className="h-5 w-5 md:h-4 md:w-4" />
                        </button>
                        <button
                          onClick={nextImage}
                          className="absolute right-2 top-1/2 transform -translate-y-1/2 bg-black bg-opacity-50 text-white p-3 md:p-2 rounded-full hover:bg-opacity-75 touch-manipulation"
                        >
                          <ChevronRight className="h-5 w-5 md:h-4 md:w-4" />
                        </button>
                      </>
                    )}
                    
                    {product.images.length > 1 && (
                      <div className="absolute bottom-2 right-2 bg-black bg-opacity-50 text-white px-2 py-1 rounded text-xs">
                        {currentImageIndex + 1} / {product.images.length}
                      </div>
                    )}
                  </div>
                  
                  {/* Miniatures */}
                  {product.images.length > 1 && (
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                      {product.images.map((image, index) => (
                        <button
                          key={index}
                          onClick={() => setCurrentImageIndex(index)}
                          className={`aspect-square rounded-lg overflow-hidden border-2 transition-all ${
                            index === currentImageIndex 
                              ? 'border-blue-500 ring-2 ring-blue-200' 
                              : 'border-gray-200 hover:border-gray-300'
                          }`}
                        >
                          <img
                            src={image}
                            alt={`${product.name} ${index + 1}`}
                            className="w-full h-full object-cover"
                          />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="aspect-square bg-gray-50 rounded-lg flex items-center justify-center">
                  <div className="text-center">
                    <Package className="h-12 w-12 text-gray-400 mx-auto mb-2" />
                    <p className="text-gray-500">Aucune image</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Informations du produit */}
        <div className="space-y-4 md:space-y-6">
          {/* Informations principales */}
          <Card>
            <CardHeader>
              <h2 className="text-xl font-semibold">Informations générales</h2>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-gray-500">Catégorie</label>
                  <p className="text-gray-900">{product.category?.name || 'Sans catégorie'}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-500">Genre</label>
                  <p className="text-gray-900">{product.genre ? formatGenre(product.genre) : '—'}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-500">Prix d'achat</label>
                  <p className="text-gray-900">
                    {product.purchase_price ? `${product.purchase_price.toFixed(2)} €` : 'Non renseigné'}
                  </p>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-500">Prix de vente</label>
                  <p className="text-lg font-semibold text-gray-900">{product.sale_price.toFixed(2)} €</p>
                </div>
              </div>
              
              {product.weight && (
                <div className="flex items-center space-x-2">
                  <Weight className="h-4 w-4 text-gray-400" />
                  <span className="text-sm text-gray-600">{product.weight}g</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* État et statut */}
          <Card>
            <CardHeader>
              <h2 className="text-xl font-semibold">État du produit</h2>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-gray-500">Condition</label>
                  <div className="mt-1">
                    <Badge variant={
                      product.condition === 'neuf' || product.condition === 'excellent' ? 'success' : 
                      product.condition === 'very-good' ? 'info' : 'default'
                    }>
                      {formatCondition(product.condition)}
                    </Badge>
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-500">Statut</label>
                  <div className="mt-1">
                    <select
                      value={product.status}
                      onChange={(e) => handleStatusChange(e.target.value)}
                      disabled={updatingStatus}
                      className={`w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm ${
                        updatingStatus ? 'opacity-50 cursor-not-allowed' : ''
                      }`}
                    >
                      <optgroup label="📝 En préparation">
                        <option value="draft">Brouillon</option>
                      </optgroup>
                      <optgroup label="🏪 Disponible à la vente">
                        <option value="for-sale-online">À vendre en ligne</option>
                        <option value="for-sale-other-platform">À vendre sur autre plateforme</option>
                        <option value="for-sale-b2b">Revendeurs B2B uniquement</option>
                      </optgroup>
                      <optgroup label="✅ Vendu">
                        <option value="sold-online">Vendu en ligne</option>
                        <option value="sold-other-platform">Vendu sur autre plateforme</option>
                        <option value="sold-display">Vendu - Affiché sur le site</option>
                      </optgroup>
                    </select>
                    {updatingStatus && (
                      <p className="text-xs text-gray-500 mt-1">Mise à jour en cours...</p>
                    )}
                    {statusUpdateSuccess && (
                      <p className="text-xs text-green-600 mt-1">✓ Statut mis à jour avec succès</p>
                    )}
                  </div>
                </div>
              </div>

              {product.material && (
                <div>
                  <label className="text-sm font-medium text-gray-500">Matière</label>
                  <p className="text-gray-900 capitalize">{product.material}</p>
                </div>
              )}

              {product.colors && product.colors.length > 0 && (
                <div>
                  <label className="text-sm font-medium text-gray-500 flex items-center">
                    <Palette className="h-4 w-4 mr-1" />
                    Couleurs
                  </label>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {product.colors.map((color, index) => (
                      <span
                        key={index}
                        className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800"
                      >
                        {color}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {product.description && (
                <div>
                  <label className="text-sm font-medium text-gray-500">Description</label>
                  <p className="text-gray-900 mt-1 whitespace-pre-line">{product.description}</p>
                </div>
              )}

              {product.defects && (
                <div>
                  <label className="text-sm font-medium text-gray-500">Défauts visibles</label>
                  <p className="text-gray-900 mt-1 whitespace-pre-line">{product.defects}</p>
                </div>
              )}

              {product.defect_images && product.defect_images.length > 0 && (
                <div>
                  <label className="text-sm font-medium text-gray-500 flex items-center">
                    <AlertTriangle className="h-4 w-4 mr-1" />
                    Photos des défauts ({product.defect_images.length})
                  </label>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {product.defect_images.map((img, index) => (
                      <button
                        key={index}
                        type="button"
                        onClick={() => setZoomedDefectImage(img)}
                        className="relative h-20 w-20 rounded-md overflow-hidden border border-red-200 group"
                      >
                        <img src={img} alt={`Défaut ${index + 1}`} className="w-full h-full object-cover" />
                        <span className="absolute inset-0 bg-black/0 group-hover:bg-black/30 flex items-center justify-center transition-colors">
                          <ZoomIn className="h-4 w-4 text-white opacity-0 group-hover:opacity-100" />
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Informations complémentaires */}
          <Card>
            <CardHeader>
              <h2 className="text-xl font-semibold">Informations complémentaires</h2>
            </CardHeader>
            <CardContent className="space-y-4">
              {product.serial_number && (
                <div>
                  <label className="text-sm font-medium text-gray-500 flex items-center">
                    <Tag className="h-4 w-4 mr-1" />
                    Numéro de série
                  </label>
                  <p className="font-mono text-gray-900">{product.serial_number}</p>
                </div>
              )}

              {product.internal_comments && (
                <div>
                  <label className="text-sm font-medium text-gray-500">Commentaires internes</label>
                  <p className="text-gray-900 mt-1">{product.internal_comments}</p>
                </div>
              )}

              <div className="pt-4 border-t border-gray-200">
                <div className="flex items-center text-sm text-gray-500">
                  <Calendar className="h-4 w-4 mr-1" />
                  Créé le {new Date(product.created_at).toLocaleDateString('fr-FR', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Étiquette imprimable (QR Code + référence) */}
          {product.reference && (
            <Card>
              <CardHeader>
                <h2 className="text-xl font-semibold">Étiquette</h2>
              </CardHeader>
              <CardContent>
                <ProductLabel
                  name={product.name}
                  reference={product.reference}
                  brandName={product.brand?.name}
                />
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Modale de validation par scan */}
      <Modal
        isOpen={showScanModal}
        onClose={() => setShowScanModal(false)}
        title="Valider par scan"
      >
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            Vise le QR Code de l'étiquette de cet article{product.barcode ? ` (${product.barcode})` : ''}.
          </p>
          <BarcodeScanner onDetected={handleScanValidate} />
          {scanError && (
            <p className="text-sm text-red-600">{scanError}</p>
          )}
        </div>
      </Modal>

      {zoomedDefectImage && (
        <div
          className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-6"
          onClick={() => setZoomedDefectImage(null)}
        >
          <button
            onClick={() => setZoomedDefectImage(null)}
            className="absolute top-4 right-4 p-2 bg-white/10 rounded-full text-white hover:bg-white/20"
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={zoomedDefectImage}
            alt="Défaut agrandi"
            className="max-w-full max-h-full rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
};