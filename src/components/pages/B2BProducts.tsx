import React, { useEffect, useState } from 'react';
import { Card, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { useAdminAuth } from '../../hooks/useAdminAuth';
import { useProducts } from '../../hooks/useProducts';
import { CreateProduct } from './CreateProduct';
import { ProductDetail } from './ProductDetail';
import { Package, Plus, Search, Trash2, AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react';

const statusOptions = [
  { value: 'for-sale-b2b', label: 'En vente (B2B)' },
  { value: 'reserved-b2b', label: 'Réservé' },
  { value: 'sold-b2b', label: 'Vendu' },
];

const statusBadge = (status: string) => {
  switch (status) {
    case 'reserved-b2b':
      return <Badge variant="info">Réservé</Badge>;
    case 'sold-b2b':
      return <Badge variant="warning">Vendu</Badge>;
    default:
      return <Badge variant="success">En vente</Badge>;
  }
};

export const B2BProducts: React.FC = () => {
  const { isAdmin } = useAdminAuth();
  const {
    products,
    loading,
    error,
    currentPage,
    totalPages,
    hasNextPage,
    hasPreviousPage,
    refreshProducts,
    setPage,
    setFilters,
    filters,
    deleteProduct,
  } = useProducts(isAdmin);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('for-sale-b2b');
  const [showCreate, setShowCreate] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);

  useEffect(() => {
    if (isAdmin) {
      setFilters({ ...filters, status: statusFilter, search: search || undefined });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, statusFilter]);

  const handleSearch = (value: string) => {
    setSearch(value);
    setFilters({ ...filters, status: statusFilter, search: value || undefined });
  };

  const handleCreate = () => {
    setSelectedProductId(null);
    setShowCreate(true);
  };

  const handleBackFromCreate = () => {
    setShowCreate(false);
    setSelectedProductId(null);
    refreshProducts();
  };

  const handleView = (productId: string) => {
    setSelectedProductId(productId);
    setShowDetail(true);
  };

  const handleEdit = (productId: string) => {
    setSelectedProductId(productId);
    setShowDetail(false);
    setShowCreate(true);
  };

  const handleDelete = async (id: string, name: string) => {
    if (window.confirm(`Supprimer le produit B2B "${name}" ?`)) {
      await deleteProduct(id);
    }
  };

  if (showCreate) {
    return <CreateProduct onBack={handleBackFromCreate} productId={selectedProductId || undefined} defaultStatus="for-sale-b2b" />;
  }

  if (showDetail && selectedProductId) {
    return (
      <ProductDetail
        productId={selectedProductId}
        onBack={() => { setShowDetail(false); setSelectedProductId(null); }}
        onEdit={handleEdit}
        onProductUpdate={refreshProducts}
      />
    );
  }

  return (
    <div className="p-4 md:p-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Produits B2B</h3>
          <p className="text-sm text-gray-500">Pièces réservées aux revendeurs, jamais visibles sur le site public</p>
        </div>
        <button
          onClick={handleCreate}
          className="flex items-center space-x-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors self-start md:self-auto"
        >
          <Plus className="h-4 w-4" />
          <span>Nouveau produit B2B</span>
        </button>
      </div>

      <div className="flex flex-col md:flex-row gap-4 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Rechercher par nom ou code..."
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:border-gray-400 focus:outline-none text-sm"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg focus:border-gray-400 focus:outline-none text-sm"
        >
          {statusOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-center space-x-3">
          <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
          <p className="text-sm text-red-700">Erreur : {error}</p>
        </div>
      )}

      {!loading && !error && products.length === 0 && (
        <div className="text-center py-12">
          <Package className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Aucun produit B2B</h3>
          <p className="text-gray-500 mb-6">Ajoute une pièce dédiée à tes revendeurs</p>
          <button
            onClick={handleCreate}
            className="inline-flex items-center space-x-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors"
          >
            <Plus className="h-4 w-4" />
            <span>Nouveau produit B2B</span>
          </button>
        </div>
      )}

      {(products.length > 0 || loading) && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-3 px-4 md:px-6 font-medium text-gray-900 text-sm">Article</th>
                    <th className="text-left py-3 px-4 md:px-6 font-medium text-gray-900 text-sm hidden sm:table-cell">Code</th>
                    <th className="text-left py-3 px-4 md:px-6 font-medium text-gray-900 text-sm">Prix</th>
                    <th className="text-left py-3 px-4 md:px-6 font-medium text-gray-900 text-sm">Statut</th>
                    <th className="text-left py-3 px-4 md:px-6 font-medium text-gray-900 text-sm">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    [...Array(4)].map((_, i) => (
                      <tr key={`skeleton-${i}`} className="border-b border-gray-50">
                        <td className="py-4 px-4 md:px-6" colSpan={5}>
                          <div className="h-4 w-full bg-gray-100 rounded animate-pulse" />
                        </td>
                      </tr>
                    ))
                  ) : (
                    products.map((product) => (
                      <tr key={product.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors cursor-pointer" onClick={() => handleView(product.id)}>
                        <td className="py-3 md:py-4 px-4 md:px-6">
                          <div className="flex items-center space-x-3">
                            <div className="h-9 w-9 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden">
                              {product.images.length > 0 ? (
                                <img src={product.images[product.main_image_index] || product.images[0]} alt={product.name} className="h-full w-full object-cover" />
                              ) : (
                                <Package className="h-4 w-4 text-gray-400" />
                              )}
                            </div>
                            <div>
                              <p className="font-medium text-gray-900 text-sm">{product.name}</p>
                              <p className="text-xs text-gray-500">{product.brand?.name || 'Sans marque'}</p>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 md:py-4 px-4 md:px-6 hidden sm:table-cell">
                          <span className="font-mono text-xs text-gray-900">{product.product_code}</span>
                        </td>
                        <td className="py-3 md:py-4 px-4 md:px-6 text-sm font-semibold text-gray-900">{product.sale_price.toFixed(0)} €</td>
                        <td className="py-3 md:py-4 px-4 md:px-6">{statusBadge(product.status)}</td>
                        <td className="py-3 md:py-4 px-4 md:px-6" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => handleDelete(product.id, product.name)}
                            className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            title="Supprimer"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {!loading && totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 mt-6">
          <button
            onClick={() => setPage(currentPage - 1)}
            disabled={!hasPreviousPage}
            className="p-2 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm text-gray-600">Page {currentPage} / {totalPages}</span>
          <button
            onClick={() => setPage(currentPage + 1)}
            disabled={!hasNextPage}
            className="p-2 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
};
