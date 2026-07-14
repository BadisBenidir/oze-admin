import React, { useState, useRef, useEffect } from 'react';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { SuccessModal } from '../ui/SuccessModal';
import { ErrorModal } from '../ui/ErrorModal';
import { useCategories } from '../../hooks/useCategories';
import { useBrands, Brand } from '../../hooks/useBrands';
import { useAdminAuth } from '../../hooks/useAdminAuth';
import { 
  ArrowLeft, 
  ArrowRight, 
  Check, 
  Upload, 
  Image as ImageIcon, 
  Package,
  Info,
  Camera,
  Settings,
  Plus,
  Search,
  X
} from 'lucide-react';

interface CreateProductProps {
  onBack: () => void;
  productId?: string; // Optionnel : si fourni, mode édition
  defaultStatus?: string; // Optionnel : préselectionne le statut (ex: création depuis la section B2B)
}

interface ProductData {
  // Étape 1: Informations génériques
  name: string;
  brand: string;
  brandName: string;
  category: string;
  genre: string;
  // Champs montants/poids : stockés en texte pour permettre la saisie (case vide,
  // virgule décimale). Convertis en nombre au moment de l'enregistrement.
  purchasePrice: string;
  salePrice: string;
  originalPrice: string;
  weight: string;

  // Étape 2: Photos
  images: string[];
  mainImageIndex: number;
  defectImages: string[]; // Photos des défauts

  // Étape 3: État du produit
  condition: string;
  description: string;
  defects: string;
  colors: string[];
  material: string;
  status: string;

  // Étape 4: Compléments
  serialNumber: string;
  internalComments: string;
}

const STEPS = [
  {
    id: 1,
    title: 'Informations génériques',
    description: 'Nom, marque, catégorie, genre et prix',
    icon: Info
  },
  {
    id: 2,
    title: 'Ajout de photos',
    description: 'Optionnel — vous pourrez les ajouter plus tard depuis « En attente »',
    icon: Camera
  },
  {
    id: 3,
    title: 'État du produit',
    description: 'Condition, stock et disponibilité',
    icon: Package
  },
  {
    id: 4,
    title: 'Compléments',
    description: 'Numéro de série et commentaires',
    icon: Settings
  }
];

// Convertit une saisie texte (avec virgule ou point) en nombre ; 0 si vide/invalide.
const parseAmount = (value: string): number => {
  const n = parseFloat((value || '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
};

export const CreateProduct: React.FC<CreateProductProps> = ({ onBack, productId, defaultStatus }) => {
  const { isAdmin } = useAdminAuth();
  const { categories } = useCategories(isAdmin);
  const { brands, totalCount: totalBrands } = useBrands(isAdmin);
  
  // Détection du mode
  const isEditMode = Boolean(productId);
  
  // Debug: afficher le nombre de marques chargées
  console.log('Marques chargées:', brands.length, 'Total marques:', totalBrands);

  const [currentStep, setCurrentStep] = useState(1);
  const [productData, setProductData] = useState<ProductData>({
    name: '',
    brand: '',
    brandName: '',
    category: '',
    genre: '',
    purchasePrice: '',
    salePrice: '',
    originalPrice: '',
    weight: '',
    images: [],
    mainImageIndex: 0,
    defectImages: [],
    condition: '',
    description: '',
    defects: '',
    colors: [],
    material: '',
    status: defaultStatus || '',
    serialNumber: '',
    internalComments: ''
  });

  const [isLoading, setIsLoading] = useState(false);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [uploadingDefectImages, setUploadingDefectImages] = useState(false);
  const [loadingProduct, setLoadingProduct] = useState(isEditMode);
  
  // États pour les modals
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [modalData, setModalData] = useState<{
    title: string;
    message: string;
    productCode?: string;
    reference?: string | null;
    name?: string;
    brandName?: string;
  }>({ title: '', message: '' });

  // États pour la recherche de marques
  const [brandSearchTerm, setBrandSearchTerm] = useState('');
  const [showBrandDropdown, setShowBrandDropdown] = useState(false);
  const [filteredBrands, setFilteredBrands] = useState<Brand[]>([]);
  const [allBrands, setAllBrands] = useState<Brand[]>([]);
  const brandSearchRef = useRef<HTMLDivElement>(null);


  const updateProductData = (updates: Partial<ProductData>) => {
    setProductData(prev => ({ ...prev, ...updates }));
  };

  // Vrai pour tout statut de la famille B2B ('for-sale-b2b', 'reserved-b2b',
  // 'sold-b2b', ...), pas seulement à la création : en édition, un produit
  // déjà réservé/vendu B2B doit garder le formulaire simplifié plutôt que de
  // basculer sur le formulaire générique du site public.
  const isB2B = productData.status.endsWith('-b2b');

  const B2B_STATUS_LABELS: Record<string, string> = {
    'for-sale-b2b': 'Revendeurs B2B uniquement',
    'reserved-b2b': 'Réservé (B2B)',
    'sold-b2b': 'Vendu (B2B)',
  };

  // Effet pour charger toutes les marques au début
  useEffect(() => {
    const loadAllBrands = async () => {
      if (!isAdmin) return;
      
      try {
        const { supabase } = await import('../../lib/supabase');
        const { data, error } = await supabase
          .from('brands')
          .select('*')
          .order('name', { ascending: true });
          
        if (error) throw error;
        setAllBrands(data || []);
        console.log('Toutes les marques chargées:', data?.length);
      } catch (error) {
        console.error('Erreur lors du chargement de toutes les marques:', error);
      }
    };
    
    loadAllBrands();
  }, [isAdmin]);

  // Effet pour charger les données du produit en mode édition
  useEffect(() => {
    const loadProductData = async () => {
      if (!isEditMode || !productId || !isAdmin) return;
      
      try {
        setLoadingProduct(true);
        const { supabase } = await import('../../lib/supabase');
        
        const { data, error } = await supabase
          .from('products')
          .select(`
            *,
            brand:brands(id, name),
            category:categories(id, name)
          `)
          .eq('id', productId)
          .single();

        if (error) {
          throw new Error(error.message);
        }

        // Pré-remplir le formulaire avec les données existantes
        setProductData({
          name: data.name,
          brand: data.brand_id || '',
          brandName: data.brand?.name || '',
          category: data.category_id || '',
          genre: data.genre,
          purchasePrice: data.purchase_price != null ? String(data.purchase_price) : '',
          salePrice: data.sale_price != null ? String(data.sale_price) : '',
          originalPrice: data.original_price != null ? String(data.original_price) : '',
          weight: data.weight != null ? String(data.weight) : '',
          images: data.images || [],
          mainImageIndex: data.main_image_index,
          defectImages: data.defect_images || [],
          condition: data.condition,
          description: data.description || '',
          defects: data.defects || '',
          colors: data.colors || [],
          material: data.material || '',
          status: data.status,
          serialNumber: data.serial_number || '',
          internalComments: data.internal_comments || ''
        });

        // Pré-remplir la recherche de marque
        if (data.brand?.name) {
          setBrandSearchTerm(data.brand.name);
        }

      } catch (error) {
        console.error('Erreur lors du chargement du produit:', error);
        setModalData({
          title: 'Erreur de chargement',
          message: error instanceof Error ? error.message : 'Impossible de charger les données du produit.'
        });
        setShowErrorModal(true);
      } finally {
        setLoadingProduct(false);
      }
    };

    loadProductData();
  }, [isEditMode, productId, isAdmin]);

  // Effet pour filtrer les marques
  useEffect(() => {
    if (brandSearchTerm.length >= 2) {
      const filtered = allBrands.filter(brand =>
        brand.name.toLowerCase().includes(brandSearchTerm.toLowerCase())
      );
      setFilteredBrands(filtered);
      setShowBrandDropdown(true);
    } else {
      setFilteredBrands([]);
      setShowBrandDropdown(false);
    }
  }, [brandSearchTerm, allBrands]);

  // Effet pour fermer le dropdown quand on clique ailleurs
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (brandSearchRef.current && !brandSearchRef.current.contains(event.target as Node)) {
        setShowBrandDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleBrandSelect = (brand: Brand) => {
    updateProductData({ 
      brand: brand.id, 
      brandName: brand.name 
    });
    setBrandSearchTerm(brand.name);
    setShowBrandDropdown(false);
  };

  const handleBrandSearchChange = (value: string) => {
    setBrandSearchTerm(value);
    if (value === '') {
      updateProductData({ brand: '', brandName: '' });
    }
  };

  const clearBrandSelection = () => {
    setBrandSearchTerm('');
    updateProductData({ brand: '', brandName: '' });
    setShowBrandDropdown(false);
  };

  // Gestion des couleurs
  const removeColor = (colorToRemove: string) => {
    const updatedColors = productData.colors.filter(color => color !== colorToRemove);
    updateProductData({ colors: updatedColors });
  };

  const nextStep = () => {
    if (currentStep < STEPS.length) {
      setCurrentStep(currentStep + 1);
    }
  };

  const prevStep = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const canProceedToNextStep = () => {
    switch (currentStep) {
      case 1:
        return productData.name && productData.brand && productData.category && (isB2B || productData.genre);
      case 2:
        return true; // Photos optionnelles à la création (à ajouter ensuite depuis « En attente »).
      case 3:
        return productData.condition && productData.status;
      case 4:
        return true;
      default:
        return false;
    }
  };

  const canSubmitProduct = () => {
    // Photos non obligatoires : on peut créer l'article puis ajouter les photos
    // plus tard depuis l'espace « En attente », avant de le scanner pour le publier.
    return productData.name.trim() &&
           productData.brand &&
           productData.category &&
           (isB2B || productData.genre) &&
           productData.condition &&
           productData.status;
  };

  const handleSubmit = async () => {
    if (!isAdmin) {
      console.error('Non autorisé');
      return;
    }

    setIsLoading(true);
    try {
      const { supabase } = await import('../../lib/supabase');
      
      // Préparer les données pour l'insertion/modification
      const productData_db = {
        name: productData.name.trim(),
        brand_id: productData.brand || null,
        category_id: productData.category || null,
        genre: productData.genre || null,
        purchase_price: parseAmount(productData.purchasePrice) || null,
        sale_price: parseAmount(productData.salePrice),
        original_price: parseAmount(productData.originalPrice) || null,
        weight: parseAmount(productData.weight) || null,
        images: productData.images,
        main_image_index: productData.mainImageIndex,
        defect_images: productData.defectImages,
        condition: productData.condition,
        description: productData.description.trim() || null,
        defects: productData.defects.trim() || null,
        colors: productData.colors,
        material: productData.material || null,
        status: productData.status,
        serial_number: productData.serialNumber.trim() || null,
        internal_comments: productData.internalComments.trim() || null
      };

      let data, error;

      if (isEditMode && productId) {
        // Mode édition : UPDATE
        console.log('Modification du produit:', productId, productData_db);
        
        const result = await supabase
          .from('products')
          .update(productData_db)
          .eq('id', productId)
          .select('*')
          .single();
          
        data = result.data;
        error = result.error;
      } else {
        // Mode création : INSERT
        console.log('Création du produit:', productData_db);
        
        const result = await supabase
          .from('products')
          .insert([productData_db])
          .select('*')
          .single();
          
        data = result.data;
        error = result.error;
      }

      if (error) {
        throw new Error(`Erreur base de données: ${error.message}`);
      }

      console.log(`Produit ${isEditMode ? 'modifié' : 'créé'} avec succès:`, data);
      
      // Afficher la modal de succès
      const baseMessage = isEditMode
        ? 'Les modifications ont été sauvegardées avec succès.'
        : 'Votre produit a été ajouté au catalogue et est maintenant disponible.';

      setModalData({
        title: isEditMode ? 'Produit modifié avec succès !' : 'Produit créé avec succès !',
        message: data.b2b_reference ? `${baseMessage} Référence B2B : ${data.b2b_reference}` : baseMessage,
        productCode: data.product_code,
        reference: data.reference,
        name: data.name,
        brandName: productData.brandName
      });
      setShowSuccessModal(true);
      
    } catch (error) {
      console.error(`Erreur lors de la ${isEditMode ? 'modification' : 'création'} du produit:`, error);
      
      // Afficher la modal d'erreur
      setModalData({
        title: isEditMode ? 'Erreur lors de la modification' : 'Erreur lors de la création',
        message: error instanceof Error ? error.message : `Une erreur inconnue s'est produite lors de la ${isEditMode ? 'modification' : 'création'} du produit.`
      });
      setShowErrorModal(true);
    } finally {
      setIsLoading(false);
    }
  };

  // Fonctions de gestion des modals
  const handleSuccessModalClose = () => {
    setShowSuccessModal(false);
    // Retourner à la liste des produits après fermeture de la modal
    onBack();
  };

  const handleErrorModalClose = () => {
    setShowErrorModal(false);
  };

  const renderStepIndicator = () => (
    <div className="mb-8">
      <div className="flex items-center justify-between">
        {STEPS.map((step, index) => {
          const isActive = step.id === currentStep;
          const isCompleted = step.id < currentStep;
          const IconComponent = step.icon;

          return (
            <div key={step.id} className="flex items-center">
              <div className={`flex items-center justify-center w-10 h-10 rounded-full border-2 ${
                isCompleted 
                  ? 'bg-green-500 border-green-500 text-white'
                  : isActive
                  ? 'bg-blue-500 border-blue-500 text-white'
                  : 'bg-white border-gray-300 text-gray-400'
              }`}>
                {isCompleted ? (
                  <Check className="w-5 h-5" />
                ) : (
                  <IconComponent className="w-5 h-5" />
                )}
              </div>
              
              <div className="ml-3">
                <p className={`text-sm font-medium ${
                  isActive ? 'text-blue-600' : isCompleted ? 'text-green-600' : 'text-gray-500'
                }`}>
                  {step.title}
                </p>
                <p className="text-xs text-gray-400">{step.description}</p>
              </div>
              
              {index < STEPS.length - 1 && (
                <div className={`flex-1 h-0.5 mx-4 ${
                  step.id < currentStep ? 'bg-green-500' : 'bg-gray-200'
                }`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  const renderStep1 = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Nom de l'article *
          </label>
          <input
            type="text"
            value={productData.name}
            onChange={(e) => updateProductData({ name: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Ex: Sac Louis Vuitton Speedy 30"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Marque *
          </label>
          <div className="relative" ref={brandSearchRef}>
            <div className="relative">
              <input
                type="text"
                value={brandSearchTerm}
                onChange={(e) => handleBrandSearchChange(e.target.value)}
                onFocus={() => {
                  if (brandSearchTerm.length >= 2) {
                    setShowBrandDropdown(true);
                  }
                }}
                className="w-full px-3 py-2 pr-8 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Rechercher une marque... (min. 2 caractères)"
              />
              <div className="absolute inset-y-0 right-0 flex items-center pr-3">
                {productData.brand ? (
                  <button
                    type="button"
                    onClick={clearBrandSelection}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <X className="h-4 w-4" />
                  </button>
                ) : (
                  <Search className="h-4 w-4 text-gray-400" />
                )}
              </div>
            </div>
            
            {/* Dropdown des résultats */}
            {showBrandDropdown && filteredBrands.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-48 overflow-y-auto">
                {filteredBrands.map((brand) => (
                  <button
                    key={brand.id}
                    type="button"
                    onClick={() => handleBrandSelect(brand)}
                    className="w-full px-3 py-2 text-left hover:bg-gray-50 focus:bg-gray-50 focus:outline-none"
                  >
                    <div className="font-medium text-gray-900">{brand.name}</div>
                    {brand.description && (
                      <div className="text-xs text-gray-500 truncate">{brand.description}</div>
                    )}
                  </button>
                ))}
              </div>
            )}
            
            {/* Message si aucun résultat */}
            {showBrandDropdown && brandSearchTerm.length >= 2 && filteredBrands.length === 0 && (
              <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg p-3">
                <div className="text-sm text-gray-500 text-center">
                  Aucune marque trouvée pour "{brandSearchTerm}"
                </div>
              </div>
            )}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Catégorie *
          </label>
          <select
            value={productData.category}
            onChange={(e) => updateProductData({ category: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Sélectionner une catégorie</option>
            {categories.map(category => (
              <option key={category.id} value={category.id}>{category.name}</option>
            ))}
          </select>
        </div>

        {!isB2B && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Genre *
            </label>
            <select
              value={productData.genre}
              onChange={(e) => updateProductData({ genre: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Sélectionner un genre</option>
              <optgroup label="👨‍👩‍ Adultes">
                <option value="femme">Femme</option>
                <option value="homme">Homme</option>
              </optgroup>
              <optgroup label="👶 Enfants">
                <option value="fille">Fille</option>
                <option value="garcon">Garçon</option>
              </optgroup>
            </select>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Poids (g)
          </label>
          <input
            type="text"
            inputMode="decimal"
            value={productData.weight}
            onChange={(e) => updateProductData({ weight: e.target.value.replace(/[^0-9.,]/g, '') })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Prix d'achat (€)
          </label>
          <input
            type="text"
            inputMode="decimal"
            value={productData.purchasePrice}
            onChange={(e) => updateProductData({ purchasePrice: e.target.value.replace(/[^0-9.,]/g, '') })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="150,00"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          {/* PRIX D'ORIGINE (BARRÉ) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Prix d'origine (barré)
            </label>
            <input
              type="text"
              inputMode="decimal"
              value={productData.originalPrice}
              onChange={(e) => updateProductData({ originalPrice: e.target.value.replace(/[^0-9.,]/g, '') })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Ex: 1200"
            />
          </div>

          {/* PRIX DE VENTE (REEL) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Prix de vente (€)
            </label>
            <input
              type="text"
              inputMode="decimal"
              value={productData.salePrice}
              onChange={(e) => updateProductData({ salePrice: e.target.value.replace(/[^0-9.,]/g, '') })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Ex: 950"
            />
            <p className="mt-1 text-xs text-gray-500">
              Optionnel. À renseigner plus tard (ex. article Live enchères : prix saisi lors de la vente).
              Un prix reste requis avant la mise en ligne d'un article sur le site.
            </p>
          </div>
        </div>
      </div>
    </div>
  );

  // Gestion des images avec Supabase Storage
  const handleImageUpload = async (files: FileList | null) => {
    if (!files || !isAdmin) return;
    
    const imageFiles = Array.from(files).filter(file => 
      file.type.startsWith('image/') && file.size <= 10 * 1024 * 1024 // 10MB max
    );
    
    if (imageFiles.length === 0) return;
    
    setUploadingImages(true);
    
    try {
      const { supabase } = await import('../../lib/supabase');
      const uploadedUrls: string[] = [];
      
      for (const file of imageFiles) {
        // Générer un nom de fichier unique
        const fileExtension = file.name.split('.').pop();
        const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExtension}`;
        
        // Upload vers le bucket products-images
        const { data, error } = await supabase.storage
          .from('products-images')
          .upload(fileName, file, {
            cacheControl: '3600',
            upsert: false
          });
          
        if (error) {
          console.error('Erreur upload image:', error);
          continue; // Continuer avec les autres images
        }
        
        // Récupérer l'URL publique
        const { data: { publicUrl } } = supabase.storage
          .from('products-images')
          .getPublicUrl(fileName);
          
        uploadedUrls.push(publicUrl);
      }
      
      if (uploadedUrls.length > 0) {
        const newImages = [...productData.images, ...uploadedUrls];
        updateProductData({ 
          images: newImages,
          mainImageIndex: productData.images.length === 0 ? 0 : productData.mainImageIndex
        });
      }
      
    } catch (error) {
      console.error('Erreur lors de l\'upload des images:', error);
    } finally {
      setUploadingImages(false);
    }
  };

  const removeImage = async (indexToRemove: number) => {
    const imageToRemove = productData.images[indexToRemove];
    const newImages = productData.images.filter((_, index) => index !== indexToRemove);
    let newMainIndex = productData.mainImageIndex;

    // Ajuster l'index de l'image principale si nécessaire
    if (indexToRemove === productData.mainImageIndex) {
      newMainIndex = 0; // Première image devient principale
    } else if (indexToRemove < productData.mainImageIndex) {
      newMainIndex = productData.mainImageIndex - 1;
    }

    updateProductData({
      images: newImages,
      mainImageIndex: newImages.length > 0 ? newMainIndex : 0
    });

    // Supprimer l'image du storage Supabase si c'est une URL Supabase
    if (imageToRemove && imageToRemove.includes('products-images') && isAdmin) {
      try {
        const { supabase } = await import('../../lib/supabase');

        // Extraire le nom du fichier de l'URL
        const url = new URL(imageToRemove);
        const pathSegments = url.pathname.split('/');
        const fileName = pathSegments[pathSegments.length - 1];

        if (fileName) {
          const { error } = await supabase.storage
            .from('products-images')
            .remove([fileName]);

          if (error) {
            console.error('Erreur lors de la suppression de l\'image du storage:', error);
          }
        }
      } catch (error) {
        console.error('Erreur lors de la suppression de l\'image:', error);
      }
    }
  };

  // Gestion des images de défauts avec Supabase Storage
  const handleDefectImageUpload = async (files: FileList | null) => {
    if (!files || !isAdmin) return;

    const imageFiles = Array.from(files).filter(file =>
      file.type.startsWith('image/') && file.size <= 10 * 1024 * 1024 // 10MB max
    );

    if (imageFiles.length === 0) return;

    setUploadingDefectImages(true);

    try {
      const { supabase } = await import('../../lib/supabase');
      const uploadedUrls: string[] = [];

      for (const file of imageFiles) {
        // Générer un nom de fichier unique
        const fileExtension = file.name.split('.').pop();
        const fileName = `defect-${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExtension}`;

        // Upload vers le bucket products-defects
        const { data, error } = await supabase.storage
          .from('products-defects')
          .upload(fileName, file, {
            cacheControl: '3600',
            upsert: false
          });

        if (error) {
          console.error('Erreur upload image défaut:', error);
          continue; // Continuer avec les autres images
        }

        // Récupérer l'URL publique
        const { data: { publicUrl } } = supabase.storage
          .from('products-defects')
          .getPublicUrl(fileName);

        uploadedUrls.push(publicUrl);
      }

      if (uploadedUrls.length > 0) {
        const newDefectImages = [...productData.defectImages, ...uploadedUrls];
        updateProductData({ defectImages: newDefectImages });
      }

    } catch (error) {
      console.error('Erreur lors de l\'upload des images de défauts:', error);
    } finally {
      setUploadingDefectImages(false);
    }
  };

  const removeDefectImage = async (indexToRemove: number) => {
    const imageToRemove = productData.defectImages[indexToRemove];
    const newDefectImages = productData.defectImages.filter((_, index) => index !== indexToRemove);

    updateProductData({ defectImages: newDefectImages });

    // Supprimer l'image du storage Supabase si c'est une URL Supabase
    if (imageToRemove && imageToRemove.includes('products-defects') && isAdmin) {
      try {
        const { supabase } = await import('../../lib/supabase');

        // Extraire le nom du fichier de l'URL
        const url = new URL(imageToRemove);
        const pathSegments = url.pathname.split('/');
        const fileName = pathSegments[pathSegments.length - 1];

        if (fileName) {
          const { error } = await supabase.storage
            .from('products-defects')
            .remove([fileName]);

          if (error) {
            console.error('Erreur lors de la suppression de l\'image de défaut du storage:', error);
          }
        }
      } catch (error) {
        console.error('Erreur lors de la suppression de l\'image de défaut:', error);
      }
    }
  };

  const handleDefectDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDefectDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    handleDefectImageUpload(e.dataTransfer.files);
  };

  const setMainImage = (index: number) => {
    updateProductData({ mainImageIndex: index });
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    handleImageUpload(e.dataTransfer.files);
  };

  const renderStep2 = () => (
    <div className="space-y-6">
      {/* Zone d'upload */}
      <div className="text-center">
        <input
          type="file"
          id="image-upload"
          multiple
          accept="image/*"
          onChange={(e) => handleImageUpload(e.target.files)}
          className="hidden"
          disabled={uploadingImages}
        />
        <label
          htmlFor="image-upload"
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          className={`block border-2 border-dashed rounded-lg p-8 transition-colors ${
            uploadingImages 
              ? 'border-blue-300 bg-blue-50 cursor-not-allowed'
              : 'border-gray-300 hover:border-gray-400 hover:bg-gray-50 cursor-pointer'
          }`}
        >
          {uploadingImages ? (
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
              <p className="text-sm text-blue-600 font-medium">Upload en cours...</p>
              <p className="text-xs text-blue-500 mt-1">Veuillez patienter</p>
            </div>
          ) : (
            <>
              <Upload className="mx-auto h-12 w-12 text-gray-400" />
              <p className="mt-2 text-sm text-gray-600">
                <strong>Cliquez pour ajouter des photos</strong> ou glissez-déposez
              </p>
              <p className="text-xs text-gray-400">
                Sélectionnez plusieurs images à la fois • PNG, JPG jusqu'à 10MB par image
              </p>
              <p className="text-xs text-blue-600 mt-1">
                💡 Maintenez Ctrl (PC) ou Cmd (Mac) pour sélectionner plusieurs photos
              </p>
            </>
          )}
        </label>
      </div>

      {/* Galerie d'images */}
      {productData.images.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-gray-700">
              Images uploadées ({productData.images.length})
            </h3>
            <p className="text-xs text-gray-500">
              Cliquez sur une image pour la définir comme image principale
            </p>
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {productData.images.map((image, index) => (
              <div key={index} className="relative group">
                <div 
                  className={`aspect-square rounded-lg overflow-hidden border-2 cursor-pointer transition-all ${
                    index === productData.mainImageIndex 
                      ? 'border-blue-500 ring-2 ring-blue-200' 
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                  onClick={() => setMainImage(index)}
                >
                  <img
                    src={image}
                    alt={`Produit ${index + 1}`}
                    className="w-full h-full object-cover"
                  />
                </div>
                
                {/* Badge image principale */}
                {index === productData.mainImageIndex && (
                  <div className="absolute -top-2 -left-2">
                    <Badge variant="default" className="bg-blue-500 text-white text-xs">
                      Principale
                    </Badge>
                  </div>
                )}
                
                {/* Bouton suppression */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeImage(index);
                  }}
                  className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                  title="Supprimer cette image"
                >
                  <X className="w-3 h-3" />
                </button>
                
                {/* Numéro de l'image */}
                <div className="absolute bottom-2 left-2 bg-black bg-opacity-50 text-white text-xs px-2 py-1 rounded">
                  {index + 1}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Informations */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start space-x-3">
          <div className="flex-shrink-0">
            <svg className="h-5 w-5 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="flex-1">
            <h4 className="text-sm font-medium text-blue-900">Conseils pour vos photos</h4>
            <div className="mt-2 text-sm text-blue-700">
              <ul className="list-disc list-inside space-y-1">
                <li>Utilisez un éclairage naturel pour des couleurs fidèles</li>
                <li>Prenez plusieurs angles : face, profil, détails</li>
                <li>La première image sera utilisée comme image principale</li>
                <li>Formats acceptés : JPG, PNG (max 10MB par image)</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* Section Photos des défauts */}
      <div className="border-t border-gray-200 pt-6 mt-6">
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center">
            <svg className="w-5 h-5 mr-2 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            Photos des défauts
          </h3>
          <p className="text-sm text-gray-500 mt-1">
            Ajoutez des photos des défauts visibles pour plus de transparence avec vos clients
          </p>
        </div>

        {/* Zone d'upload défauts */}
        <div className="text-center">
          <label
            htmlFor="defect-image-upload"
            onDragOver={handleDefectDragOver}
            onDrop={handleDefectDrop}
            className={`block border-2 border-dashed rounded-lg p-6 transition-colors relative ${
              uploadingDefectImages
                ? 'border-orange-300 bg-orange-50 cursor-not-allowed'
                : 'border-orange-200 hover:border-orange-400 hover:bg-orange-50 cursor-pointer'
            }`}
          >
            <input
              type="file"
              id="defect-image-upload"
              multiple
              accept="image/*"
              onChange={(e) => handleDefectImageUpload(e.target.files)}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              disabled={uploadingDefectImages}
            />
            {uploadingDefectImages ? (
              <div className="text-center">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-orange-600 mx-auto mb-3"></div>
                <p className="text-sm text-orange-600 font-medium">Upload en cours...</p>
              </div>
            ) : (
              <>
                <svg className="mx-auto h-10 w-10 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <p className="mt-2 text-sm text-gray-600">
                  <strong className="text-orange-600">Ajouter des photos de défauts</strong>
                </p>
                <p className="text-xs text-gray-400">
                  Rayures, taches, usures... • PNG, JPG jusqu'à 10MB
                </p>
              </>
            )}
          </label>
        </div>

        {/* Galerie des images de défauts */}
        {productData.defectImages.length > 0 && (
          <div className="space-y-4 mt-4">
            <h4 className="text-sm font-medium text-gray-700">
              Photos de défauts ({productData.defectImages.length})
            </h4>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {productData.defectImages.map((image, index) => (
                <div key={index} className="relative group">
                  <div className="aspect-square rounded-lg overflow-hidden border-2 border-orange-200">
                    <img
                      src={image}
                      alt={`Défaut ${index + 1}`}
                      className="w-full h-full object-cover"
                    />
                  </div>

                  {/* Badge défaut */}
                  <div className="absolute -top-2 -left-2">
                    <Badge variant="default" className="bg-orange-500 text-white text-xs">
                      Défaut
                    </Badge>
                  </div>

                  {/* Bouton suppression */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeDefectImage(index);
                    }}
                    className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                    title="Supprimer cette image"
                  >
                    <X className="w-3 h-3" />
                  </button>

                  {/* Numéro de l'image */}
                  <div className="absolute bottom-2 left-2 bg-orange-500 bg-opacity-80 text-white text-xs px-2 py-1 rounded">
                    {index + 1}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Note sur les défauts */}
        <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 mt-4">
          <p className="text-xs text-orange-700">
            <strong>💡 Conseil :</strong> Les photos de défauts seront affichées séparément sur la fiche produit.
            Cela rassure les acheteurs et réduit les retours.
          </p>
        </div>
      </div>
    </div>
  );

  const renderStep3 = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            {isB2B ? 'Grade *' : 'État/Condition *'}
          </label>
          <select
            value={productData.condition}
            onChange={(e) => updateProductData({ condition: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {isB2B ? (
              <>
                <option value="">Sélectionner un grade</option>
                <option value="S">Grade S</option>
                <option value="A">Grade A</option>
                <option value="AB">Grade AB</option>
                <option value="B">Grade B</option>
                <option value="BC">Grade BC</option>
                <option value="C">Grade C</option>
                <option value="D">Grade D</option>
              </>
            ) : (
              <>
                <option value="">Sélectionner l'état</option>
                <option value="neuf">Neuf</option>
                <option value="excellent">Excellent</option>
                <option value="very-good">Très bon</option>
                <option value="good">Bon</option>
                <option value="fair">Correct</option>
              </>
            )}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Statut *
          </label>
          {isB2B ? (
            <div className="w-full px-3 py-2 border border-gray-200 rounded-md bg-gray-50 flex items-center">
              <Badge variant="info">{B2B_STATUS_LABELS[productData.status] || productData.status}</Badge>
            </div>
          ) : (
            <select
              value={productData.status}
              onChange={(e) => updateProductData({ status: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Sélectionner un statut</option>
              <optgroup label="📝 En préparation">
                <option value="draft">À valider (mise en ligne après scan)</option>
              </optgroup>
              <optgroup label="🏪 Disponible à la vente">
                <option value="for-sale-other-platform">À vendre sur une autre plateforme</option>
                <option value="for-sale-b2b">Revendeurs B2B uniquement</option>
              </optgroup>
              <optgroup label="🔨 Live enchères">
                <option value="for-auction-live">À vendre en live enchères</option>
              </optgroup>
              <optgroup label="✅ Vendu">
                <option value="sold-online">Vendu en ligne</option>
                <option value="sold-other-platform">Vendu sur une autre plateforme</option>
                <option value="sold-display">Vendu - Affiché sur le site</option>
                <option value="sold-auction">Vendu en live enchères</option>
              </optgroup>
            </select>
          )}
        </div>

        {!isB2B && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Matière
            </label>
            <select
              value={productData.material}
              onChange={(e) => updateProductData({ material: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Sélectionner une matière</option>
              <optgroup label="🐄 Cuirs">
                <option value="agneau">Agneau</option>
                <option value="chevreau">Chevreau</option>
                <option value="cuir">Cuir</option>
                <option value="cuir-grainé">Cuir grainé</option>
                <option value="cuir-lisse">Cuir lisse</option>
                <option value="cuir-nappa">Cuir Nappa</option>
                <option value="cuir-saffiano">Cuir Saffiano</option>
                <option value="cuir-verni">Cuir verni</option>
                <option value="daim">Daim</option>
                <option value="nubuck">Nubuck</option>
                <option value="veau">Veau</option>
              </optgroup>
              <optgroup label="🧵 Textiles">
                <option value="cachemire">Cachemire</option>
                <option value="canvas">Canvas</option>
                <option value="coton">Coton</option>
                <option value="denim">Denim</option>
                <option value="jacquard">Jacquard</option>
                <option value="laine">Laine</option>
                <option value="lin">Lin</option>
                <option value="satin">Satin</option>
                <option value="soie">Soie</option>
                <option value="toile">Toile</option>
                <option value="velours">Velours</option>
              </optgroup>
              <optgroup label="🐍 Cuirs exotiques">
                <option value="alligator">Alligator</option>
                <option value="autruche">Autruche</option>
                <option value="crocodile">Crocodile</option>
                <option value="lezard">Lézard</option>
                <option value="python">Python</option>
                <option value="serpent">Serpent</option>
              </optgroup>
              <optgroup label="🔗 Métaux et synthétiques">
                <option value="acier">Acier</option>
                <option value="aluminium">Aluminium</option>
                <option value="caoutchouc">Caoutchouc</option>
                <option value="cuir-synthetique">Cuir synthétique</option>
                <option value="metal">Métal</option>
                <option value="plastique">Plastique</option>
                <option value="vinyle">Vinyle</option>
              </optgroup>
              <optgroup label="🌟 Matières de luxe">
                <option value="cristal">Cristal</option>
                <option value="fourrure">Fourrure</option>
                <option value="lapin">Lapin</option>
                <option value="plumes">Plumes</option>
                <option value="renard">Renard</option>
                <option value="strass">Strass</option>
                <option value="vison">Vison</option>
              </optgroup>
              <optgroup label="🎨 Autres">
                <option value="autre">Autre</option>
                <option value="mixte">Mixte</option>
              </optgroup>
            </select>
          </div>
        )}

        {!isB2B && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Couleurs
            </label>
            <div className="space-y-3">
              {/* Menu déroulant pour sélectionner les couleurs */}
              <select
                onChange={(e) => {
                  const selectedColor = e.target.value;
                  if (selectedColor && !productData.colors.includes(selectedColor)) {
                    updateProductData({ colors: [...productData.colors, selectedColor] });
                  }
                  e.target.value = ''; // Reset selection
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Sélectionner une couleur...</option>
                <optgroup label="🔴 Rouges">
                  <option value="rouge">Rouge</option>
                  <option value="bordeaux">Bordeaux</option>
                  <option value="cerise">Cerise</option>
                  <option value="corail">Corail</option>
                  <option value="fuchsia">Fuchsia</option>
                  <option value="grenat">Grenat</option>
                  <option value="magenta">Magenta</option>
                  <option value="rose">Rose</option>
                  <option value="saumon">Saumon</option>
                </optgroup>
                <optgroup label="🔵 Bleus">
                  <option value="bleu">Bleu</option>
                  <option value="azur">Azur</option>
                  <option value="bleu-ciel">Bleu ciel</option>
                  <option value="bleu-marine">Bleu marine</option>
                  <option value="bleu-roi">Bleu roi</option>
                  <option value="cobalt">Cobalt</option>
                  <option value="cyan">Cyan</option>
                  <option value="indigo">Indigo</option>
                  <option value="turquoise">Turquoise</option>
                </optgroup>
                <optgroup label="🟢 Verts">
                  <option value="vert">Vert</option>
                  <option value="emeraude">Émeraude</option>
                  <option value="jade">Jade</option>
                  <option value="kaki">Kaki</option>
                  <option value="menthe">Menthe</option>
                  <option value="olive">Olive</option>
                  <option value="sapin">Sapin</option>
                  <option value="vert-eau">Vert d'eau</option>
                  <option value="vert-pomme">Vert pomme</option>
                </optgroup>
                <optgroup label="🟡 Jaunes">
                  <option value="jaune">Jaune</option>
                  <option value="ambre">Ambre</option>
                  <option value="citron">Citron</option>
                  <option value="dore">Doré</option>
                  <option value="miel">Miel</option>
                  <option value="moutarde">Moutarde</option>
                  <option value="ocre">Ocre</option>
                  <option value="safran">Safran</option>
                </optgroup>
                <optgroup label="🟠 Oranges">
                  <option value="orange">Orange</option>
                  <option value="abricot">Abricot</option>
                  <option value="bronze">Bronze</option>
                  <option value="cuivre">Cuivre</option>
                  <option value="mandarine">Mandarine</option>
                  <option value="peche">Pêche</option>
                  <option value="rouille">Rouille</option>
                </optgroup>
                <optgroup label="🟣 Violets">
                  <option value="violet">Violet</option>
                  <option value="aubergine">Aubergine</option>
                  <option value="lavande">Lavande</option>
                  <option value="lilas">Lilas</option>
                  <option value="mauve">Mauve</option>
                  <option value="parme">Parme</option>
                  <option value="pourpre">Pourpre</option>
                  <option value="prune">Prune</option>
                </optgroup>
                <optgroup label="🤎 Bruns">
                  <option value="brun">Brun</option>
                  <option value="beige">Beige</option>
                  <option value="camel">Camel</option>
                  <option value="chocolat">Chocolat</option>
                  <option value="cognac">Cognac</option>
                  <option value="marron">Marron</option>
                  <option value="noisette">Noisette</option>
                  <option value="tabac">Tabac</option>
                  <option value="taupe">Taupe</option>
                </optgroup>
                <optgroup label="⚫ Neutres">
                  <option value="noir">Noir</option>
                  <option value="blanc">Blanc</option>
                  <option value="gris">Gris</option>
                  <option value="argent">Argenté</option>
                  <option value="anthracite">Anthracite</option>
                  <option value="ecru">Écru</option>
                  <option value="ivoire">Ivoire</option>
                </optgroup>
                <optgroup label="✨ Spéciaux">
                  <option value="multicolore">Multicolore</option>
                  <option value="transparente">Transparente</option>
                  <option value="holographique">Holographique</option>
                  <option value="metallique">Métallique</option>
                  <option value="nacre">Nacré</option>
                </optgroup>
              </select>

              {/* Liste des couleurs sélectionnées */}
              {productData.colors.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {productData.colors.map((color, index) => (
                    <span
                      key={index}
                      className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800"
                    >
                      {color}
                      <button
                        type="button"
                        onClick={() => removeColor(color)}
                        className="ml-2 text-gray-400 hover:text-gray-600"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Description du produit
        </label>
        <textarea
          rows={4}
          value={productData.description}
          onChange={(e) => updateProductData({ description: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Description détaillée du produit, caractéristiques, histoire, etc..."
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Défauts visibles
        </label>
        <textarea
          rows={3}
          value={productData.defects}
          onChange={(e) => updateProductData({ defects: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Décrire les éventuels défauts, rayures, usures, taches... (laisser vide si aucun défaut)"
        />
        <p className="mt-1 text-xs text-gray-500">
          Soyez transparent sur l'état réel du produit pour éviter les retours
        </p>
      </div>
    </div>
  );

  const renderStep4 = () => (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Numéro de série
        </label>
        <input
          type="text"
          value={productData.serialNumber}
          onChange={(e) => updateProductData({ serialNumber: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Ex: LB-SAC-2024-001, série fabricant..."
        />
        <p className="mt-1 text-xs text-gray-500">
          Numéro unique pour identifier ce produit spécifique
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Commentaires internes
        </label>
        <textarea
          rows={4}
          value={productData.internalComments}
          onChange={(e) => updateProductData({ internalComments: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Notes internes pour l'équipe : origine, historique, particularités, instructions de stockage..."
        />
        <p className="mt-1 text-xs text-gray-500">
          Ces informations ne seront visibles que par l'équipe administrative
        </p>
      </div>
    </div>
  );

  const renderCurrentStep = () => {
    switch (currentStep) {
      case 1: return renderStep1();
      case 2: return renderStep2();
      case 3: return renderStep3();
      case 4: return renderStep4();
      default: return null;
    }
  };

  // Affichage du skeleton pendant le chargement du produit à éditer
  if (loadingProduct) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="animate-pulse">
          <div className="mb-8">
            <div className="h-4 w-48 bg-gray-200 rounded mb-4"></div>
            <div className="h-8 w-64 bg-gray-200 rounded mb-2"></div>
            <div className="h-4 w-96 bg-gray-200 rounded"></div>
          </div>
          
          <div className="mb-8">
            <div className="flex items-center justify-between mb-8">
              {[...Array(4)].map((_, index) => (
                <div key={index} className="flex items-center">
                  <div className="w-10 h-10 bg-gray-200 rounded-full"></div>
                  <div className="ml-3">
                    <div className="h-4 w-24 bg-gray-200 rounded mb-1"></div>
                    <div className="h-3 w-32 bg-gray-200 rounded"></div>
                  </div>
                  {index < 3 && <div className="flex-1 h-0.5 mx-4 bg-gray-200"></div>}
                </div>
              ))}
            </div>
          </div>

          <div className="mb-8">
            <div className="h-96 bg-gray-200 rounded-lg"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      {/* En-tête */}
      <div className="mb-6 md:mb-8">
        <button
          onClick={onBack}
          className="flex items-center text-gray-600 hover:text-gray-800 mb-4 transition-colors touch-manipulation min-h-[44px]"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          <span className="text-sm md:text-base">Retour à la liste des produits</span>
        </button>
        
        <h1 className="text-2xl font-bold text-gray-900">
          {isEditMode ? 'Modifier le produit' : 'Créer un nouveau produit'}
        </h1>
        <p className="text-gray-600">
          {isEditMode 
            ? 'Modifiez les informations du produit en suivant les étapes'
            : 'Suivez les étapes pour ajouter un produit à votre catalogue'
          }
        </p>
      </div>

      {/* Indicateur d'étapes */}
      {renderStepIndicator()}

      {/* Contenu de l'étape courante */}
      <Card className="mb-8">
        <CardHeader>
          <h2 className="text-xl font-semibold text-gray-900">
            {STEPS[currentStep - 1].title}
          </h2>
          <p className="text-gray-600">{STEPS[currentStep - 1].description}</p>
        </CardHeader>
        <CardContent>
          {renderCurrentStep()}
        </CardContent>
      </Card>

      {/* Boutons de navigation */}
      <div className="flex justify-between">
        <button
          onClick={prevStep}
          disabled={currentStep === 1}
          className="flex items-center px-4 py-2 text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Précédent
        </button>

        {currentStep < STEPS.length ? (
          <button
            onClick={nextStep}
            disabled={!canProceedToNextStep()}
            className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Suivant
            <ArrowRight className="h-4 w-4 ml-2" />
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={isLoading || !canSubmitProduct()}
            className="flex items-center px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                {isEditMode ? 'Sauvegarde...' : 'Création...'}
              </>
            ) : (
              <>
                <Check className="h-4 w-4 mr-2" />
                {isEditMode ? 'Sauvegarder les modifications' : 'Créer le produit'}
              </>
            )}
          </button>
        )}
      </div>

      {/* Modals */}
      <SuccessModal
        isOpen={showSuccessModal}
        onClose={handleSuccessModalClose}
        title={modalData.title}
        message={modalData.message}
        productCode={modalData.productCode}
        reference={modalData.reference}
        productName={modalData.name}
        brandName={modalData.brandName}
      />

      <ErrorModal
        isOpen={showErrorModal}
        onClose={handleErrorModalClose}
        title={modalData.title}
        message={modalData.message}
      />
    </div>
  );
};