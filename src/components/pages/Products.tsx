import React, { useState } from 'react';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { CategoryModal } from '../ui/CategoryModal';
import { BrandModal } from '../ui/BrandModal';
import { Modal } from '../ui/Modal';
import { CreateProduct } from './CreateProduct';
import { ProductDetail } from './ProductDetail';
import { ProductLabel } from '../products/ProductLabel';
import { ProductScannerPage } from '../products/ProductScannerPage';
import { PendingProductsPage } from '../products/PendingProductsPage';
import { LiveAuctionPage } from '../products/LiveAuctionPage';
import { useCategories, Category } from '../../hooks/useCategories';
import { useBrands, Brand } from '../../hooks/useBrands';
import { useProducts, ProductFilters } from '../../hooks/useProducts';
import { useDashboardStats } from '../../hooks/useDashboardStats';
import { useAdminAuth } from '../../hooks/useAdminAuth';
import { Plus, Edit, Trash2, Eye, Package, AlertCircle, TrendingUp, Tag } from 'lucide-react';

interface ProductsProps {
  activeSubTab: string;
}

export const Products: React.FC<ProductsProps> = ({ activeSubTab }) => {
  const { isAdmin } = useAdminAuth()
  const { 
    categories, 
    loading: loadingCategories, 
    error: errorCategories,
    totalCount: totalCategories,
    currentPage: currentPageCategories,
    totalPages: totalPagesCategories,
    hasNextPage: hasNextPageCategories,
    hasPreviousPage: hasPreviousPageCategories,
    setPage: setCategoriesPage,
    createCategory,
    updateCategory,
    deleteCategory
  } = useCategories(isAdmin)
  
  const { 
    brands, 
    loading: loadingBrands, 
    error: errorBrands,
    totalCount: totalBrands,
    currentPage: currentPageBrands,
    totalPages: totalPagesBrands,
    hasNextPage: hasNextPageBrands,
    hasPreviousPage: hasPreviousPageBrands,
    setPage: setBrandsPage,
    createBrand,
    updateBrand,
    deleteBrand
  } = useBrands(isAdmin)
  
  const { 
    products, 
    loading: loadingProducts, 
    error: errorProducts,
    totalCount: totalProducts,
    currentPage: currentPageProducts,
    totalPages: totalPagesProducts,
    hasNextPage: hasNextPageProducts,
    hasPreviousPage: hasPreviousPageProducts,
    setPage: setProductsPage,
    refreshProducts,
    setFilters,
    filters,
    deleteProduct
  } = useProducts(isAdmin)
  
  const { 
    stats, 
    loading: loadingStats, 
    error: errorStats,
    refreshStats
  } = useDashboardStats(isAdmin)

  // États pour les modals des catégories
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false)
  const [editingCategory, setEditingCategory] = useState<Category | null>(null)
  const [categoryModalLoading, setCategoryModalLoading] = useState(false)

  // États pour les modals des marques
  const [isBrandModalOpen, setIsBrandModalOpen] = useState(false)
  const [editingBrand, setEditingBrand] = useState<Brand | null>(null)
  const [brandModalLoading, setBrandModalLoading] = useState(false)

  // État pour la page de création de produit
  const [showCreateProduct, setShowCreateProduct] = useState(false)
  
  // État pour la page de détail de produit
  const [showProductDetail, setShowProductDetail] = useState(false)
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null)

  // État pour la modale d'étiquette (QR/code-barres) depuis la liste
  const [labelProduct, setLabelProduct] = useState<{ name: string; reference: string; brandName?: string } | null>(null)

  // Fonctions pour les catégories
  const handleCreateCategory = () => {
    setEditingCategory(null)
    setIsCategoryModalOpen(true)
  }

  const handleEditCategory = (category: Category) => {
    setEditingCategory(category)
    setIsCategoryModalOpen(true)
  }

  const handleSaveCategory = async (categoryData: Partial<Category>) => {
    setCategoryModalLoading(true)
    try {
      if (editingCategory) {
        await updateCategory(editingCategory.id, categoryData)
      } else {
        await createCategory(categoryData)
      }
    } catch (error) {
      // L'erreur est déjà loggée dans le hook
    } finally {
      setCategoryModalLoading(false)
    }
  }

  const handleDeleteCategory = async (id: string) => {
    if (confirm('Êtes-vous sûr de vouloir supprimer cette catégorie ?')) {
      try {
        await deleteCategory(id)
      } catch (error) {
        // L'erreur est déjà loggée dans le hook
      }
    }
  }

  // Fonctions pour les marques
  const handleCreateBrand = () => {
    setEditingBrand(null)
    setIsBrandModalOpen(true)
  }

  const handleEditBrand = (brand: Brand) => {
    setEditingBrand(brand)
    setIsBrandModalOpen(true)
  }

  const handleSaveBrand = async (brandData: Partial<Brand>) => {
    setBrandModalLoading(true)
    try {
      if (editingBrand) {
        await updateBrand(editingBrand.id, brandData)
      } else {
        await createBrand(brandData)
      }
    } catch (error) {
      // L'erreur est déjà loggée dans le hook
    } finally {
      setBrandModalLoading(false)
    }
  }

  const handleDeleteBrand = async (id: string) => {
    if (confirm('Êtes-vous sûr de vouloir supprimer cette marque ?')) {
      try {
        await deleteBrand(id)
      } catch (error) {
        // L'erreur est déjà loggée dans le hook
      }
    }
  }

  // Fonction pour gérer la création de produit
  const handleCreateProduct = () => {
    setSelectedProductId(null)  // Reset pour création
    setShowCreateProduct(true)
  }

  const handleBackFromCreateProduct = () => {
    setShowCreateProduct(false)
    setSelectedProductId(null)  // Reset l'ID sélectionné
    // Rafraîchir la liste des produits
    refreshProducts()
  }

  const handleEditProduct = (productId: string) => {
    setSelectedProductId(productId)
    setShowProductDetail(false)  // Fermer les détails si ouverts
    setShowCreateProduct(true)   // Ouvrir l'éditeur
  }

  // Fonctions pour les produits
  const handleDeleteProduct = async (id: string, productName: string) => {
    if (confirm(`Êtes-vous sûr de vouloir supprimer le produit "${productName}" ?`)) {
      try {
        await deleteProduct(id)
      } catch (error) {
        // L'erreur est déjà loggée dans le hook
      }
    }
  }

  const handleViewProduct = (productId: string) => {
    setSelectedProductId(productId)
    setShowProductDetail(true)
  }

  const handleBackFromProductDetail = () => {
    setShowProductDetail(false)
    setSelectedProductId(null)
  }

  // Si on est sur la page de création/édition de produit
  if (showCreateProduct) {
    return <CreateProduct onBack={handleBackFromCreateProduct} productId={selectedProductId || undefined} />
  }

  // Si on est sur la page de détail de produit
  if (showProductDetail && selectedProductId) {
    return <ProductDetail 
      productId={selectedProductId} 
      onBack={handleBackFromProductDetail}
      onEdit={handleEditProduct}
      onProductUpdate={refreshProducts}
    />
  }

  if (activeSubTab === 'tableau-de-bord') {
    if (loadingStats) {
      return (
        <div className="p-4 md:p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 md:gap-6 mb-6 md:mb-8">
            {[...Array(5)].map((_, index) => (
              <Card key={index}>
                <CardContent className="p-6">
                  <div className="animate-pulse">
                    <div className="h-4 w-24 bg-gray-200 rounded mb-2"></div>
                    <div className="h-8 w-16 bg-gray-200 rounded mb-2"></div>
                    <div className="h-4 w-20 bg-gray-200 rounded"></div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )
    }

    if (errorStats || !stats) {
      return (
        <div className="p-6">
          <div className="text-center py-12">
            <AlertCircle className="h-12 w-12 text-red-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">Erreur lors du chargement des statistiques</h3>
            <p className="text-gray-500 mb-4">{errorStats || 'Une erreur inconnue s\'est produite'}</p>
            <button 
              onClick={refreshStats}
              className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors"
            >
              Réessayer
            </button>
          </div>
        </div>
      )
    }

    return (
      <div className="p-4 md:p-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 md:gap-6 mb-6 md:mb-8">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Total Produits</p>
                  <p className="text-2xl font-bold text-gray-900">{stats.totalProducts}</p>
                  <div className="flex items-center mt-2">
                    <span className="text-sm text-gray-600">{stats.categoriesCount} catégories</span>
                  </div>
                </div>
                <div className="h-12 w-12 bg-blue-50 rounded-lg flex items-center justify-center">
                  <Package className="h-6 w-6 text-blue-600" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Produits en Vente</p>
                  <p className="text-2xl font-bold text-gray-900">{stats.productsForSale}</p>
                  <div className="flex items-center mt-2">
                    <span className="text-sm text-green-600">
                      {stats.totalProducts > 0 ? Math.round((stats.productsForSale / stats.totalProducts) * 100) : 0}% du catalogue
                    </span>
                  </div>
                </div>
                <div className="h-12 w-12 bg-green-50 rounded-lg flex items-center justify-center">
                  <Eye className="h-6 w-6 text-green-600" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Produits Vendus</p>
                  <p className="text-2xl font-bold text-gray-900">{stats.soldProducts}</p>
                  <div className="flex items-center mt-2">
                    <span className="text-sm text-blue-600">{stats.draftProducts} brouillons</span>
                  </div>
                </div>
                <div className="h-12 w-12 bg-orange-50 rounded-lg flex items-center justify-center">
                  <Package className="h-6 w-6 text-orange-600" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Valeur Stock</p>
                  <p className="text-2xl font-bold text-gray-900">{stats.totalValue.toFixed(0)}€</p>
                  <div className="flex items-center mt-2">
                    <span className="text-sm text-purple-600">Moy. {stats.averagePrice.toFixed(0)}€</span>
                  </div>
                </div>
                <div className="h-12 w-12 bg-purple-50 rounded-lg flex items-center justify-center">
                  <Package className="h-6 w-6 text-purple-600" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Marge Potentielle</p>
                  <p className="text-2xl font-bold text-gray-900">{stats.potentialMargin.toFixed(0)}€</p>
                  <div className="flex items-center mt-2">
                    <span className={`text-sm ${stats.potentialMargin >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {stats.totalSaleValue > 0 ? Math.round((stats.potentialMargin / stats.totalSaleValue) * 100) : 0}% de marge
                    </span>
                  </div>
                </div>
                <div className="h-12 w-12 bg-emerald-50 rounded-lg flex items-center justify-center">
                  <TrendingUp className="h-6 w-6 text-emerald-600" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <Card>
            <CardHeader>
              <h3 className="text-lg font-semibold text-gray-900">Analyse des Coûts</h3>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Valeur totale des achats</span>
                  <span className="text-sm font-medium text-gray-900">{stats.totalPurchaseValue.toFixed(2)}€</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Valeur totale de vente</span>
                  <span className="text-sm font-medium text-gray-900">{stats.totalSaleValue.toFixed(2)}€</span>
                </div>
                <div className="pt-2 border-t border-gray-200">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-900">Marge brute</span>
                    <span className={`text-sm font-bold ${stats.potentialMargin >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {stats.potentialMargin >= 0 ? '+' : ''}{stats.potentialMargin.toFixed(2)}€
                    </span>
                  </div>
                </div>
                <div className="text-xs text-gray-500 mt-2">
                  Prix d'achat moyen : {stats.averagePurchasePrice.toFixed(2)}€
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <h3 className="text-lg font-semibold text-gray-900">Répartition Financière</h3>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-gray-600">Stock en vente</span>
                    <span className="text-sm font-medium text-gray-900">{stats.totalValue.toFixed(0)}€</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-blue-600 h-2 rounded-full" 
                      style={{ 
                        width: stats.totalSaleValue > 0 ? `${Math.min((stats.totalValue / stats.totalSaleValue) * 100, 100)}%` : '0%' 
                      }}
                    ></div>
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-gray-600">Investissement total</span>
                    <span className="text-sm font-medium text-gray-900">{stats.totalPurchaseValue.toFixed(0)}€</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-orange-600 h-2 rounded-full" 
                      style={{ 
                        width: stats.totalSaleValue > 0 ? `${(stats.totalPurchaseValue / stats.totalSaleValue) * 100}%` : '0%' 
                      }}
                    ></div>
                  </div>
                </div>
                {stats.potentialMargin > 0 && (
                  <div className="pt-2 border-t border-gray-200">
                    <p className="text-xs text-gray-500">
                      ROI potentiel : {stats.totalPurchaseValue > 0 ? Math.round((stats.potentialMargin / stats.totalPurchaseValue) * 100) : 0}%
                    </p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-6 mb-8">
          <Card>
            <CardHeader>
              <h3 className="text-lg font-semibold text-gray-900">Analyse Financière par Statut</h3>
              <p className="text-sm text-gray-500">Détail des marges et investissements pour chaque statut de produit</p>
            </CardHeader>
            <CardContent className="overflow-hidden">
              <div className="overflow-x-auto -mx-4 md:mx-0">
                <div className="inline-block min-w-full align-middle px-4 md:px-0">
                  <table className="min-w-full w-full">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left py-3 px-4 font-medium text-gray-900 text-sm">STATUT</th>
                      <th className="text-center py-3 px-4 font-medium text-gray-900 text-sm">PRODUITS</th>
                      <th className="text-right py-3 px-4 font-medium text-gray-900 text-sm">ACHAT TOTAL</th>
                      <th className="text-right py-3 px-4 font-medium text-gray-900 text-sm">VENTE TOTAL</th>
                      <th className="text-right py-3 px-4 font-medium text-gray-900 text-sm">MARGE</th>
                      <th className="text-right py-3 px-4 font-medium text-gray-900 text-sm">PRIX MOY.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.statusBreakdown.map((status) => {
                      const statusLabels: { [key: string]: string } = {
                        'draft': 'Brouillon',
                        'for-sale-online': 'En vente en ligne',
                        'for-sale-other-platform': 'Autre plateforme',
                        'for-sale-b2b': 'Revendeurs B2B',
                        'sold-online': 'Vendu en ligne',
                        'sold-other-platform': 'Vendu ailleurs',
                        'sold-display': 'Vendu - Affiché',
                        'for-auction-live': 'Live enchères',
                        'sold-auction': 'Vendu (live)',
                        'reserved-b2b': 'Réservé (B2B)',
                        'sold-b2b': 'Vendu (B2B)'
                      };

                      const statusColors: { [key: string]: string } = {
                        'draft': 'bg-gray-100 text-gray-800',
                        'for-sale-online': 'bg-green-100 text-green-800',
                        'for-sale-other-platform': 'bg-blue-100 text-blue-800',
                        'for-sale-b2b': 'bg-teal-100 text-teal-800',
                        'sold-online': 'bg-orange-100 text-orange-800',
                        'sold-other-platform': 'bg-yellow-100 text-yellow-800',
                        'sold-display': 'bg-purple-100 text-purple-800',
                        'for-auction-live': 'bg-indigo-100 text-indigo-800',
                        'sold-auction': 'bg-pink-100 text-pink-800',
                        'reserved-b2b': 'bg-amber-100 text-amber-800',
                        'sold-b2b': 'bg-teal-100 text-teal-800'
                      };

                      const marginPercentage = status.totalSaleValue > 0 
                        ? Math.round((status.potentialMargin / status.totalSaleValue) * 100) 
                        : 0;

                      return (
                        <tr key={status.status} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                          <td className="py-4 px-4">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                              statusColors[status.status] || 'bg-gray-100 text-gray-800'
                            }`}>
                              {statusLabels[status.status] || status.status}
                            </span>
                          </td>
                          <td className="py-4 px-4 text-center">
                            <div className="text-sm font-medium text-gray-900">{status.count}</div>
                            <div className="text-xs text-gray-500">({status.percentage}%)</div>
                          </td>
                          <td className="py-4 px-4 text-right">
                            {status.totalPurchaseValue > 0 ? (
                              <div>
                                <div className="text-sm font-medium text-gray-900">
                                  {status.totalPurchaseValue.toFixed(0)}€
                                </div>
                                <div className="text-xs text-gray-500">
                                  moy. {status.averagePurchasePrice.toFixed(0)}€
                                </div>
                              </div>
                            ) : (
                              <span className="text-sm text-gray-400">-</span>
                            )}
                          </td>
                          <td className="py-4 px-4 text-right">
                            <div>
                              <div className="text-sm font-medium text-gray-900">
                                {status.totalSaleValue > 0 ? status.totalSaleValue.toFixed(0) : status.averageSalePrice.toFixed(0)}€
                              </div>
                              <div className="text-xs text-gray-500">
                                moy. {status.averageSalePrice.toFixed(0)}€
                              </div>
                            </div>
                          </td>
                          <td className="py-4 px-4 text-right">
                            {status.totalPurchaseValue > 0 ? (
                              <div>
                                <div className={`text-sm font-bold ${
                                  status.potentialMargin >= 0 ? 'text-green-600' : 'text-red-600'
                                }`}>
                                  {status.potentialMargin >= 0 ? '+' : ''}{status.potentialMargin.toFixed(0)}€
                                </div>
                                <div className={`text-xs ${
                                  marginPercentage >= 0 ? 'text-green-600' : 'text-red-600'
                                }`}>
                                  {marginPercentage}% marge
                                </div>
                              </div>
                            ) : (
                              <span className="text-sm text-gray-400">-</span>
                            )}
                          </td>
                          <td className="py-4 px-4 text-right">
                            <div className="text-xs text-gray-500">
                              {status.totalPurchaseValue > 0 && status.potentialMargin > 0 ? (
                                <span className="text-green-600">
                                  ROI {Math.round((status.potentialMargin / status.totalPurchaseValue) * 100)}%
                                </span>
                              ) : (
                                <span>-</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">

          <Card>
            <CardHeader>
              <h3 className="text-lg font-semibold text-gray-900">Top Catégories</h3>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {stats.topCategories.length > 0 ? (
                  stats.topCategories.map((category) => (
                    <div key={category.category_id} className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">{category.category_name}</span>
                      <span className="text-sm font-medium text-gray-900">{category.product_count} produits</span>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-gray-500 text-center py-4">Aucune catégorie trouvée</p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <h3 className="text-lg font-semibold text-gray-900">Top Marques</h3>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {stats.topBrands.length > 0 ? (
                  stats.topBrands.map((brand) => (
                    <div key={brand.brand_id} className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">{brand.brand_name}</span>
                      <span className="text-sm font-medium text-gray-900">{brand.product_count} produits</span>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-gray-500 text-center py-4">Aucune marque trouvée</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {stats.recentProducts.length > 0 && (
          <Card>
            <CardHeader>
              <h3 className="text-lg font-semibold text-gray-900">Produits Récents</h3>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {stats.recentProducts.map((product) => (
                  <div key={product.id} className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{product.name}</p>
                      <p className="text-xs text-gray-500">
                        {product.brand_name && `${product.brand_name} • `}
                        {new Date(product.created_at).toLocaleDateString('fr-FR')}
                      </p>
                    </div>
                    <span className="text-sm font-medium text-gray-900">{product.sale_price.toFixed(2)}€</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <div className="mt-6 text-center">
          <p className="text-sm text-gray-500">
            Données basées sur {stats.brandsCount} marques • Dernière mise à jour : {new Date().toLocaleTimeString('fr-FR')}
          </p>
        </div>
      </div>
    );
  }

  if (activeSubTab === 'categories') {
    return (
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Gestion des Catégories</h3>
            <p className="text-sm text-gray-500">
              {loadingCategories ? 'Chargement...' : `${totalCategories} catégorie${totalCategories > 1 ? 's' : ''} (page ${currentPageCategories}/${totalPagesCategories})`}
            </p>
          </div>
          <button 
            onClick={handleCreateCategory}
            className="flex items-center space-x-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors"
          >
            <Plus className="h-4 w-4" />
            <span>Nouvelle Catégorie</span>
          </button>
        </div>

        {/* Message d'erreur */}
        {errorCategories && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-center space-x-3">
            <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
            <p className="text-sm text-red-700">Erreur lors du chargement des catégories : {errorCategories}</p>
          </div>
        )}

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-4 px-6 font-medium text-gray-900">Nom</th>
                    <th className="text-left py-4 px-6 font-medium text-gray-900">Description</th>
                    <th className="text-left py-4 px-6 font-medium text-gray-900">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingCategories ? (
                    // Skeleton loading
                    [...Array(5)].map((_, index) => (
                      <tr key={`skeleton-${index}`} className="border-b border-gray-50">
                        <td className="py-4 px-6">
                          <div className="h-4 w-24 bg-gray-200 rounded animate-pulse"></div>
                        </td>
                        <td className="py-4 px-6">
                          <div className="h-4 w-32 bg-gray-200 rounded animate-pulse"></div>
                        </td>
                        <td className="py-4 px-6">
                          <div className="flex items-center space-x-2">
                            <div className="h-6 w-6 bg-gray-200 rounded animate-pulse"></div>
                            <div className="h-6 w-6 bg-gray-200 rounded animate-pulse"></div>
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    categories.map((category) => (
                      <tr key={category.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                        <td className="py-4 px-6">
                          <p className="font-medium text-gray-900">{category.name}</p>
                        </td>
                        <td className="py-4 px-6">
                          <span className="text-sm text-gray-600">{category.description || '-'}</span>
                        </td>
                        <td className="py-4 px-6">
                          <div className="flex items-center space-x-2">
                            <button 
                              onClick={() => handleEditCategory(category)}
                              className="p-1 text-gray-400 hover:text-green-600 transition-colors" 
                              title="Modifier"
                            >
                              <Edit className="h-4 w-4" />
                            </button>
                            <button 
                              onClick={() => handleDeleteCategory(category.id)}
                              className="p-1 text-gray-400 hover:text-red-600 transition-colors" 
                              title="Supprimer"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Pagination pour les catégories */}
        {totalPagesCategories > 1 && (
          <div className="mt-6 flex items-center justify-between">
            <div className="text-sm text-gray-500">
              Affichage de {Math.min((currentPageCategories - 1) * 10 + 1, totalCategories)} à {Math.min(currentPageCategories * 10, totalCategories)} sur {totalCategories} catégories
            </div>
            
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setCategoriesPage(currentPageCategories - 1)}
                disabled={!hasPreviousPageCategories}
                className="px-3 py-1 text-sm border border-gray-200 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Précédent
              </button>
              
              {[...Array(totalPagesCategories)].map((_, index) => {
                const page = index + 1
                return (
                  <button
                    key={page}
                    onClick={() => setCategoriesPage(page)}
                    className={`px-3 py-1 text-sm border rounded-md ${
                      page === currentPageCategories
                        ? 'bg-gray-900 text-white border-gray-900'
                        : 'border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    {page}
                  </button>
                )
              })}
              
              <button
                onClick={() => setCategoriesPage(currentPageCategories + 1)}
                disabled={!hasNextPageCategories}
                className="px-3 py-1 text-sm border border-gray-200 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Suivant
              </button>
            </div>
          </div>
        )}

        {/* Modal pour les catégories */}
        <CategoryModal
          isOpen={isCategoryModalOpen}
          onClose={() => setIsCategoryModalOpen(false)}
          onSave={handleSaveCategory}
          category={editingCategory}
          isLoading={categoryModalLoading}
        />
      </div>
    );
  }

  if (activeSubTab === 'marques') {
    return (
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Gestion des Marques</h3>
            <p className="text-sm text-gray-500">
              {loadingBrands ? 'Chargement...' : `${totalBrands} marque${totalBrands > 1 ? 's' : ''} (page ${currentPageBrands}/${totalPagesBrands})`}
            </p>
          </div>
          <button 
            onClick={handleCreateBrand}
            className="flex items-center space-x-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors"
          >
            <Plus className="h-4 w-4" />
            <span>Nouvelle Marque</span>
          </button>
        </div>

        {/* Message d'erreur */}
        {errorBrands && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-center space-x-3">
            <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
            <p className="text-sm text-red-700">Erreur lors du chargement des marques : {errorBrands}</p>
          </div>
        )}

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-4 px-6 font-medium text-gray-900">Nom</th>
                    <th className="text-left py-4 px-6 font-medium text-gray-900">Description</th>
                    <th className="text-left py-4 px-6 font-medium text-gray-900">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingBrands ? (
                    // Skeleton loading
                    [...Array(10)].map((_, index) => (
                      <tr key={`skeleton-${index}`} className="border-b border-gray-50">
                        <td className="py-4 px-6">
                          <div className="h-4 w-24 bg-gray-200 rounded animate-pulse"></div>
                        </td>
                        <td className="py-4 px-6">
                          <div className="h-4 w-40 bg-gray-200 rounded animate-pulse"></div>
                        </td>
                        <td className="py-4 px-6">
                          <div className="flex items-center space-x-2">
                            <div className="h-6 w-6 bg-gray-200 rounded animate-pulse"></div>
                            <div className="h-6 w-6 bg-gray-200 rounded animate-pulse"></div>
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    brands.map((brand) => (
                      <tr key={brand.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                        <td className="py-4 px-6">
                          <p className="font-medium text-gray-900">{brand.name}</p>
                        </td>
                        <td className="py-4 px-6">
                          <span className="text-sm text-gray-600 max-w-xs truncate block">
                            {brand.description || '-'}
                          </span>
                        </td>
                        <td className="py-4 px-6">
                          <div className="flex items-center space-x-2">
                            <button 
                              onClick={() => handleEditBrand(brand)}
                              className="p-1 text-gray-400 hover:text-green-600 transition-colors" 
                              title="Modifier"
                            >
                              <Edit className="h-4 w-4" />
                            </button>
                            <button 
                              onClick={() => handleDeleteBrand(brand.id)}
                              className="p-1 text-gray-400 hover:text-red-600 transition-colors" 
                              title="Supprimer"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Pagination pour les marques */}
        {totalPagesBrands > 1 && (
          <div className="mt-6 flex items-center justify-between">
            <div className="text-sm text-gray-500">
              Affichage de {Math.min((currentPageBrands - 1) * 10 + 1, totalBrands)} à {Math.min(currentPageBrands * 10, totalBrands)} sur {totalBrands} marques
            </div>
            
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setBrandsPage(currentPageBrands - 1)}
                disabled={!hasPreviousPageBrands}
                className="px-3 py-1 text-sm border border-gray-200 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Précédent
              </button>
              
              {[...Array(totalPagesBrands)].map((_, index) => {
                const page = index + 1
                return (
                  <button
                    key={page}
                    onClick={() => setBrandsPage(page)}
                    className={`px-3 py-1 text-sm border rounded-md ${
                      page === currentPageBrands
                        ? 'bg-gray-900 text-white border-gray-900'
                        : 'border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    {page}
                  </button>
                )
              })}
              
              <button
                onClick={() => setBrandsPage(currentPageBrands + 1)}
                disabled={!hasNextPageBrands}
                className="px-3 py-1 text-sm border border-gray-200 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Suivant
              </button>
            </div>
          </div>
        )}

        {/* Modal pour les marques */}
        <BrandModal
          isOpen={isBrandModalOpen}
          onClose={() => setIsBrandModalOpen(false)}
          onSave={handleSaveBrand}
          brand={editingBrand}
          isLoading={brandModalLoading}
        />
      </div>
    );
  }

  if (activeSubTab === 'scanner') {
    return <ProductScannerPage onOpenProduct={handleViewProduct} />
  }

  if (activeSubTab === 'en-attente') {
    return <PendingProductsPage onEdit={handleEditProduct} onView={handleViewProduct} />
  }

  if (activeSubTab === 'live-encheres') {
    return <LiveAuctionPage onEdit={handleEditProduct} onView={handleViewProduct} />
  }

  // Default products list (activeSubTab === 'produits')
  return (
    <div className="p-4 md:p-6">
      <div className="mb-4 md:mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Liste des Produits</h3>
            <p className="text-sm text-gray-500">
              {loadingProducts ? 'Chargement...' : `${totalProducts} produit${totalProducts > 1 ? 's' : ''} (page ${currentPageProducts}/${totalPagesProducts})`}
            </p>
          </div>
          <button 
            onClick={handleCreateProduct}
            className="flex items-center space-x-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors"
          >
            <Plus className="h-4 w-4" />
            <span>Nouveau Produit</span>
          </button>
        </div>
      </div>

      {/* Message d'erreur */}
      {errorProducts && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-center space-x-3">
          <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
          <p className="text-sm text-red-700">Erreur lors du chargement des produits : {errorProducts}</p>
        </div>
      )}

{/* Search and Filters */}      <div className="mb-4 md:mb-6 space-y-4">        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">          <div className="relative w-full md:max-w-md">            <input              type="text"              placeholder="Rechercher par nom, marque ou SKU..."              value={filters.search || ''}              onChange={(e) => setFilters({ ...filters, search: e.target.value || undefined })}              className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:border-gray-400 focus:outline-none text-sm"            />            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">              <svg className="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />              </svg>            </div>          </div>          <div className="grid grid-cols-2 md:flex md:items-center gap-2 md:gap-3">            <select              className="px-3 py-2 border border-gray-200 rounded-lg focus:border-gray-400 focus:outline-none text-sm"              value={filters.categoryId || ''}              onChange={(e) => setFilters({ ...filters, categoryId: e.target.value || undefined })}            >              <option value="">Toutes catégories</option>              {categories.map((category) => (                <option key={category.id} value={category.id}>{category.name}</option>              ))}            </select>            <select              className="px-3 py-2 border border-gray-200 rounded-lg focus:border-gray-400 focus:outline-none text-sm"              value={filters.status || ''}              onChange={(e) => setFilters({ ...filters, status: e.target.value || undefined })}            >              <option value="">Tous statuts</option>              <option value="draft">Brouillon</option>              <option value="for-sale-online">En vente en ligne</option>              <option value="for-sale-other-platform">Autre plateforme</option>              <option value="for-sale-b2b">Revendeurs B2B</option>              <option value="for-auction-live">Live enchères</option>              <option value="sold-online">Vendu en ligne</option>              <option value="sold-other-platform">Vendu ailleurs</option>              <option value="sold-display">Vendu - Affiché</option>              <option value="sold-auction">Vendu (live)</option>            </select>            <select              className="px-3 py-2 border border-gray-200 rounded-lg focus:border-gray-400 focus:outline-none text-sm md:col-span-1 col-span-2"              value={filters.sortBy || 'recent'}              onChange={(e) => setFilters({ ...filters, sortBy: e.target.value as ProductFilters['sortBy'] })}            >              <option value="recent">Récent</option>              <option value="oldest">Plus ancien</option>              <option value="price-asc">Prix croissant</option>              <option value="price-desc">Prix décroissant</option>            </select>            <select className="px-3 py-2 border border-gray-200 rounded-lg focus:border-gray-400 focus:outline-none text-sm hidden md:block">              <option>20 par page</option>              <option>50 par page</option>              <option>100 par page</option>            </select>          </div>        </div>      </div>      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto -mx-4 md:mx-0">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-3 md:py-4 px-4 md:px-6 font-medium text-gray-900 text-xs md:text-sm">ARTICLE</th>
                  <th className="text-left py-3 md:py-4 px-4 md:px-6 font-medium text-gray-900 text-xs md:text-sm hidden sm:table-cell">SKU</th>
                  <th className="text-left py-3 md:py-4 px-4 md:px-6 font-medium text-gray-900 text-xs md:text-sm hidden md:table-cell">CATÉGORIE</th>
                  <th className="text-left py-3 md:py-4 px-4 md:px-6 font-medium text-gray-900 text-xs md:text-sm">PRIX</th>
                  <th className="text-left py-3 md:py-4 px-4 md:px-6 font-medium text-gray-900 text-xs md:text-sm hidden lg:table-cell">ÉTAT</th>
                  <th className="text-left py-3 md:py-4 px-4 md:px-6 font-medium text-gray-900 text-xs md:text-sm">STATUT</th>
                  <th className="text-left py-3 md:py-4 px-4 md:px-6 font-medium text-gray-900 text-xs md:text-sm">ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {loadingProducts ? (
                  // Skeleton loading
                  [...Array(10)].map((_, index) => (
                    <tr key={`skeleton-${index}`} className="border-b border-gray-50">
                      <td className="py-3 md:py-4 px-4 md:px-6">
                        <div className="flex items-center space-x-3">
                          <div className="h-8 w-8 md:h-10 md:w-10 bg-gray-200 rounded-lg animate-pulse"></div>
                          <div>
                            <div className="h-4 w-32 bg-gray-200 rounded animate-pulse mb-1"></div>
                            <div className="h-3 w-20 bg-gray-200 rounded animate-pulse"></div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 md:py-4 px-4 md:px-6 hidden sm:table-cell">
                        <div className="h-4 w-24 bg-gray-200 rounded animate-pulse"></div>
                      </td>
                      <td className="py-3 md:py-4 px-4 md:px-6 hidden md:table-cell">
                        <div className="h-4 w-16 bg-gray-200 rounded animate-pulse"></div>
                      </td>
                      <td className="py-3 md:py-4 px-4 md:px-6">
                        <div className="h-4 w-16 bg-gray-200 rounded animate-pulse"></div>
                      </td>
                      <td className="py-3 md:py-4 px-4 md:px-6 hidden lg:table-cell">
                        <div className="h-6 w-16 bg-gray-200 rounded animate-pulse"></div>
                      </td>
                      <td className="py-3 md:py-4 px-4 md:px-6">
                        <div className="h-6 w-20 bg-gray-200 rounded animate-pulse"></div>
                      </td>
                      <td className="py-3 md:py-4 px-4 md:px-6">
                        <div className="flex items-center space-x-1 md:space-x-2">
                          <div className="h-6 w-6 bg-gray-200 rounded animate-pulse"></div>
                          <div className="h-6 w-6 bg-gray-200 rounded animate-pulse"></div>
                          <div className="h-6 w-6 bg-gray-200 rounded animate-pulse hidden md:block"></div>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  products.map((product) => (
                    <tr key={product.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                      <td className="py-3 md:py-4 px-4 md:px-6">
                        <div className="flex items-center space-x-3">
                          <div className="h-8 w-8 md:h-10 md:w-10 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0">
                            {product.images.length > 0 ? (
                              <img 
                                src={product.images[product.main_image_index] || product.images[0]} 
                                alt={product.name}
                                className="h-full w-full object-cover rounded-lg"
                              />
                            ) : (
                              <Package className="h-5 w-5 text-gray-400" />
                            )}
                          </div>
                          <div>
                            <p className="font-medium text-gray-900 text-sm md:text-base">{product.name}</p>
                            <p className="text-xs md:text-sm text-gray-500">{product.brand?.name || 'Sans marque'}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 md:py-4 px-4 md:px-6 hidden sm:table-cell">
                        <span className="font-mono text-xs md:text-sm text-gray-900">{product.product_code}</span>
                      </td>
                      <td className="py-3 md:py-4 px-4 md:px-6 hidden md:table-cell">
                        <span className="text-xs md:text-sm text-gray-900">{product.category?.name || 'Sans catégorie'}</span>
                      </td>
                      <td className="py-3 md:py-4 px-4 md:px-6">
                        <span className="font-medium text-gray-900 text-sm md:text-base">{product.sale_price.toFixed(2)} €</span>
                      </td>
                      <td className="py-3 md:py-4 px-4 md:px-6 hidden lg:table-cell">
                        <Badge variant={
                          product.condition === 'neuf' || product.condition === 'excellent' ? 'success' : 
                          product.condition === 'very-good' ? 'info' : 
                          'default'
                        }>
                          {product.condition === 'neuf' ? 'Neuf' :
                           product.condition === 'excellent' ? 'Excellent' :
                           product.condition === 'very-good' ? 'Très bon' :
                           product.condition === 'good' ? 'Bon' :
                           product.condition === 'fair' ? 'Correct' :
                           ['A','AB','B','BC','C','D'].includes(product.condition) ? `État ${product.condition}` :
                           'Correct'}
                        </Badge>
                      </td>
                      <td className="py-3 md:py-4 px-4 md:px-6">
                        <Badge variant={
                          product.status === 'for-sale-online' || product.status === 'for-sale-b2b' ? 'success' :
                          product.status === 'sold-online' || product.status === 'sold-other-platform' || product.status === 'sold-auction' || product.status === 'sold-b2b' ? 'warning' :
                          product.status === 'sold-display' || product.status === 'for-auction-live' || product.status === 'reserved-b2b' ? 'info' :
                          product.status === 'draft' ? 'default' :
                          'info'
                        }>
                          {product.status === 'draft' ? 'Brouillon' :
                           product.status === 'for-sale-online' ? 'En vente' :
                           product.status === 'for-sale-other-platform' ? 'Autre plateforme' :
                           product.status === 'for-sale-b2b' ? 'Revendeurs B2B' :
                           product.status === 'reserved-b2b' ? 'Réservé (B2B)' :
                           product.status === 'sold-b2b' ? 'Vendu (B2B)' :
                           product.status === 'for-auction-live' ? 'Live enchères' :
                           product.status === 'sold-online' ? 'Vendu' :
                           product.status === 'sold-display' ? 'Vendu - Affiché' :
                           product.status === 'sold-auction' ? 'Vendu (live)' :
                           'Vendu ailleurs'}
                        </Badge>
                      </td>
                      <td className="py-3 md:py-4 px-4 md:px-6">
                        <div className="flex items-center space-x-1">
                          <button
                            onClick={() => handleViewProduct(product.id)}
                            className="p-2 md:p-1 text-gray-400 hover:text-blue-600 transition-colors touch-manipulation min-h-[44px] md:min-h-0 flex items-center justify-center"
                            title="Voir"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => product.reference && setLabelProduct({
                              name: product.name,
                              reference: product.reference,
                              brandName: product.brand?.name,
                            })}
                            disabled={!product.reference}
                            className="p-2 md:p-1 text-gray-400 hover:text-gray-900 transition-colors touch-manipulation min-h-[44px] md:min-h-0 flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed"
                            title={product.reference ? "Étiquette (imprimer / PDF)" : "Aucune référence (produit créé avant la mise à jour)"}
                          >
                            <Tag className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleEditProduct(product.id)}
                            className="p-2 md:p-1 text-gray-400 hover:text-green-600 transition-colors touch-manipulation min-h-[44px] md:min-h-0 flex items-center justify-center"
                            title="Modifier"
                          >
                            <Edit className="h-4 w-4" />
                          </button>
                          <button 
                            onClick={() => handleDeleteProduct(product.id, product.name)}
                            className="p-2 md:p-1 text-gray-400 hover:text-red-600 transition-colors touch-manipulation min-h-[44px] md:min-h-0 flex items-center justify-center hidden sm:flex"
                            title="Supprimer"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Pagination pour les produits */}
      {totalPagesProducts > 1 && (
        <div className="mt-6 flex items-center justify-between">
          <div className="text-sm text-gray-500">
            Affichage de {Math.min((currentPageProducts - 1) * 20 + 1, totalProducts)} à {Math.min(currentPageProducts * 20, totalProducts)} sur {totalProducts} produits
          </div>
          
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setProductsPage(currentPageProducts - 1)}
              disabled={!hasPreviousPageProducts}
              className="px-3 py-1 text-sm border border-gray-200 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Précédent
            </button>
            
            {[...Array(totalPagesProducts)].map((_, index) => {
              const page = index + 1
              return (
                <button
                  key={page}
                  onClick={() => setProductsPage(page)}
                  className={`px-3 py-1 text-sm border rounded-md ${
                    page === currentPageProducts
                      ? 'bg-gray-900 text-white border-gray-900'
                      : 'border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  {page}
                </button>
              )
            })}
            
            <button
              onClick={() => setProductsPage(currentPageProducts + 1)}
              disabled={!hasNextPageProducts}
              className="px-3 py-1 text-sm border border-gray-200 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Suivant
            </button>
          </div>
        </div>
      )}

      {/* Modale d'étiquette (impression + téléchargement PDF) */}
      <Modal
        isOpen={Boolean(labelProduct)}
        onClose={() => setLabelProduct(null)}
        title="Étiquette produit"
      >
        {labelProduct && (
          <ProductLabel
            name={labelProduct.name}
            reference={labelProduct.reference}
            brandName={labelProduct.brandName}
          />
        )}
      </Modal>
    </div>
  );
};