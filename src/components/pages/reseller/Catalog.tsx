import React, { useState } from 'react';
import { Card, CardContent } from '../../ui/Card';
import { Badge } from '../../ui/Badge';
import { useResellerAuth } from '../../../hooks/useResellerAuth';
import { useB2BCatalog, B2BCatalogItem } from '../../../hooks/useB2BCatalog';
import { useB2BCart } from '../../../hooks/useB2BCart';
import { GRADE_VARIANTS, isGrade } from '../../../utils/productGrade';
import { Search, ShoppingCart, ImageOff, Check, Package, ChevronLeft, ChevronRight, Clock } from 'lucide-react';

interface CatalogProps {
  onOpenProduct: (productId: string) => void;
}

export const Catalog: React.FC<CatalogProps> = ({ onOpenProduct }) => {
  const { isReseller, profile } = useResellerAuth();
  const { items, loading, error, currentPage, totalPages, hasNextPage, hasPreviousPage, search, setSearch, setPage } = useB2BCatalog(isReseller);
  const cart = useB2BCart(profile?.reseller_id);

  return (
    <div className="p-4 md:p-6">
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-gray-900">Catalogue</h3>
        <p className="text-sm text-gray-500">Pièces réservées aux revendeurs</p>
      </div>

      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input
          type="text"
          placeholder="Rechercher un article..."
          className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:border-gray-400 focus:outline-none"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">Erreur : {error}</div>
      )}

      {!loading && !error && items.length === 0 && (
        <div className="text-center py-12">
          <Package className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Aucun article disponible</h3>
          <p className="text-gray-500">Revenez bientôt, de nouvelles pièces arrivent régulièrement.</p>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {loading
          ? [...Array(8)].map((_, i) => (
              <Card key={`skeleton-${i}`}>
                <div className="h-40 bg-gray-100 rounded-t-lg animate-pulse" />
                <CardContent className="p-3 space-y-2">
                  <div className="h-4 bg-gray-100 rounded animate-pulse" />
                  <div className="h-4 w-16 bg-gray-100 rounded animate-pulse" />
                </CardContent>
              </Card>
            ))
          : items.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                inCart={cart.isInCart(product.id)}
                onAdd={() => cart.addItem(product)}
                onView={() => onOpenProduct(product.id)}
              />
            ))}
      </div>

      {!loading && totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 mt-8">
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

interface ProductCardProps {
  product: B2BCatalogItem;
  inCart: boolean;
  onAdd: () => Promise<{ success: boolean; error?: string }>;
  onView: () => void;
}

const ProductCard: React.FC<ProductCardProps> = ({ product, inCart, onAdd, onView }) => {
  const image = product.images?.[product.main_image_index] || product.images?.[0];
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const held = product.held_by_other && !inCart;
  const disabled = adding || inCart || held;

  const handleAdd = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setAddError(null);
    setAdding(true);
    const result = await onAdd();
    setAdding(false);
    if (!result.success) {
      setAddError(result.error || 'Erreur');
    }
  };

  return (
    <Card hover className="overflow-hidden flex flex-col cursor-pointer" onClick={onView}>
      <div className="h-40 bg-gray-100 flex items-center justify-center overflow-hidden">
        {image ? (
          <img src={image} alt={product.name} className="w-full h-full object-cover" />
        ) : (
          <ImageOff className="h-8 w-8 text-gray-300" />
        )}
      </div>
      <CardContent className="p-3 flex-1 flex flex-col">
        <p className="text-sm font-medium text-gray-900 line-clamp-2 mb-1">{product.name}</p>
        {product.brand?.name && <p className="text-xs text-gray-500 mb-2">{product.brand.name}</p>}
        <div className="mt-auto space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-base font-semibold text-gray-900">{product.price.toFixed(0)} €</span>
            {isGrade(product.condition) && (
              <Badge variant={GRADE_VARIANTS[product.condition]}>Grade {product.condition}</Badge>
            )}
          </div>
          <button
            onClick={handleAdd}
            disabled={disabled}
            className={`w-full flex items-center justify-center space-x-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
              inCart
                ? 'bg-green-50 text-green-700 cursor-default'
                : disabled
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                : 'bg-gray-900 text-white hover:bg-gray-800'
            }`}
          >
            {inCart ? (
              <>
                <Check className="h-3 w-3" />
                <span>Dans le panier</span>
              </>
            ) : held ? (
              <>
                <Clock className="h-3 w-3" />
                <span>En cours de réservation</span>
              </>
            ) : (
              <>
                <ShoppingCart className="h-3 w-3" />
                <span>{adding ? 'Ajout...' : 'Ajouter'}</span>
              </>
            )}
          </button>
          {addError && <p className="text-[11px] text-red-600">{addError}</p>}
        </div>
      </CardContent>
    </Card>
  );
};
