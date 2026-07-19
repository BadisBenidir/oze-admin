import React, { useMemo, useState } from 'react';
import { Card, CardContent } from '../../ui/Card';
import { Badge } from '../../ui/Badge';
import { useResellerAuth } from '../../../hooks/useResellerAuth';
import { useB2BCatalog, B2BCatalogItem } from '../../../hooks/useB2BCatalog';
import { useB2BCart } from '../../../hooks/useB2BCart';
// ⚠️ `cart` doit toujours venir de l'instance unique créée dans ResellerApp
// et reçue ici en prop, jamais d'un nouvel appel local à useB2BCart() : deux
// instances = deux états séparés qui écrivent le même localStorage sans se
// notifier l'une l'autre. C'est ce qui causait un panier "ajouté" qui ne se
// reflétait dans le badge/la page panier qu'après rechargement complet.
import { GRADE_VARIANTS, isGrade } from '../../../utils/productGrade';
import {
  Search,
  ShoppingCart,
  ImageOff,
  Check,
  Package,
  ChevronLeft,
  ChevronRight,
  Clock,
  SlidersHorizontal,
  X,
  RotateCcw,
} from 'lucide-react';

const PRICE_BRACKETS: { id: string; label: string; min: number | null; max: number | null }[] = [
  { id: 'all', label: 'Tous les prix', min: null, max: null },
  { id: 'b0', label: 'Moins de 500 €', min: null, max: 500 },
  { id: 'b1', label: '500 € – 1 500 €', min: 500, max: 1500 },
  { id: 'b2', label: '1 500 € – 3 000 €', min: 1500, max: 3000 },
  { id: 'b3', label: 'Plus de 3 000 €', min: 3000, max: null },
];

const priceBracketId = (min: number | null, max: number | null): string => {
  const match = PRICE_BRACKETS.find((b) => b.min === min && b.max === max);
  return match?.id ?? 'all';
};

interface CatalogProps {
  cart: ReturnType<typeof useB2BCart>;
  onOpenProduct: (productId: string) => void;
}

export const Catalog: React.FC<CatalogProps> = ({ cart, onOpenProduct }) => {
  const { isReseller } = useResellerAuth();
  const {
    items,
    loading,
    error,
    currentPage,
    totalPages,
    hasNextPage,
    hasPreviousPage,
    filters,
    setFilters,
    resetFilters,
    setPage,
    facets,
  } = useB2BCatalog(isReseller);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  const toggleInList = (id: string, list: string[]) =>
    list.includes(id) ? list.filter((v) => v !== id) : [...list, id];

  const activeFilterCount =
    filters.brandIds.length +
    filters.categoryIds.length +
    filters.conditions.length +
    (filters.priceMin !== null || filters.priceMax !== null ? 1 : 0);

  const currentPriceBracket = useMemo(
    () => priceBracketId(filters.priceMin, filters.priceMax),
    [filters.priceMin, filters.priceMax]
  );

  return (
    <div className="p-4 md:p-6">
      <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Catalogue</h3>
          <p className="text-sm text-gray-500">Pièces réservées aux revendeurs</p>
        </div>
        <button
          onClick={() => setMobileFiltersOpen(true)}
          className="lg:hidden relative flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          <SlidersHorizontal className="h-4 w-4" />
          Filtres
          {activeFilterCount > 0 && (
            <span className="absolute -top-2 -right-2 h-5 w-5 flex items-center justify-center bg-gray-900 text-white text-[11px] rounded-full">
              {activeFilterCount}
            </span>
          )}
        </button>
      </div>

      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input
          type="text"
          placeholder="Rechercher un article..."
          className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:border-gray-400 focus:outline-none"
          value={filters.search}
          onChange={(e) => setFilters({ search: e.target.value })}
        />
      </div>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">Erreur : {error}</div>
      )}

      <div className="flex gap-6 items-start">
        <aside className="hidden lg:block w-64 shrink-0 sticky top-6">
          <FiltersPanel
            facets={facets}
            selectedBrandIds={filters.brandIds}
            selectedCategoryIds={filters.categoryIds}
            selectedConditions={filters.conditions}
            priceBracketId={currentPriceBracket}
            onToggleBrand={(id) => setFilters({ brandIds: toggleInList(id, filters.brandIds) })}
            onToggleCategory={(id) => setFilters({ categoryIds: toggleInList(id, filters.categoryIds) })}
            onToggleCondition={(c) => setFilters({ conditions: toggleInList(c, filters.conditions) })}
            onSelectPriceBracket={(id) => {
              const bracket = PRICE_BRACKETS.find((b) => b.id === id) ?? PRICE_BRACKETS[0];
              setFilters({ priceMin: bracket.min, priceMax: bracket.max });
            }}
            onReset={resetFilters}
            activeFilterCount={activeFilterCount}
          />
        </aside>

        <div className="flex-1 min-w-0">
          {!loading && !error && items.length === 0 && (
            <div className="text-center py-12">
              <Package className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">Aucun article disponible</h3>
              <p className="text-gray-500 mb-4">
                {activeFilterCount > 0 || filters.search
                  ? "Essayez d'élargir votre recherche ou vos filtres."
                  : 'Revenez bientôt, de nouvelles pièces arrivent régulièrement.'}
              </p>
              {(activeFilterCount > 0 || filters.search) && (
                <button
                  onClick={resetFilters}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50"
                >
                  <RotateCcw className="h-4 w-4" />
                  Réinitialiser les filtres
                </button>
              )}
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
      </div>

      {mobileFiltersOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileFiltersOpen(false)} />
          <div className="absolute right-0 top-0 h-full w-full max-w-sm bg-white shadow-xl flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-gray-100">
              <h4 className="font-semibold text-gray-900">Filtres</h4>
              <button onClick={() => setMobileFiltersOpen(false)} className="p-1 text-gray-500 hover:text-gray-800">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <FiltersPanel
                facets={facets}
                selectedBrandIds={filters.brandIds}
                selectedCategoryIds={filters.categoryIds}
                selectedConditions={filters.conditions}
                priceBracketId={currentPriceBracket}
                onToggleBrand={(id) => setFilters({ brandIds: toggleInList(id, filters.brandIds) })}
                onToggleCategory={(id) => setFilters({ categoryIds: toggleInList(id, filters.categoryIds) })}
                onToggleCondition={(c) => setFilters({ conditions: toggleInList(c, filters.conditions) })}
                onSelectPriceBracket={(id) => {
                  const bracket = PRICE_BRACKETS.find((b) => b.id === id) ?? PRICE_BRACKETS[0];
                  setFilters({ priceMin: bracket.min, priceMax: bracket.max });
                }}
                onReset={resetFilters}
                activeFilterCount={activeFilterCount}
              />
            </div>
            <div className="p-4 border-t border-gray-100">
              <button
                onClick={() => setMobileFiltersOpen(false)}
                className="w-full py-2.5 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800"
              >
                Voir les résultats
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Sous-composants
// ---------------------------------------------------------------------------

interface FiltersPanelProps {
  facets: { brands: { id: string; name: string }[]; categories: { id: string; name: string }[]; conditions: string[] };
  selectedBrandIds: string[];
  selectedCategoryIds: string[];
  selectedConditions: string[];
  priceBracketId: string;
  onToggleBrand: (id: string) => void;
  onToggleCategory: (id: string) => void;
  onToggleCondition: (condition: string) => void;
  onSelectPriceBracket: (id: string) => void;
  onReset: () => void;
  activeFilterCount: number;
}

const FiltersPanel: React.FC<FiltersPanelProps> = ({
  facets,
  selectedBrandIds,
  selectedCategoryIds,
  selectedConditions,
  priceBracketId,
  onToggleBrand,
  onToggleCategory,
  onToggleCondition,
  onSelectPriceBracket,
  onReset,
  activeFilterCount,
}) => {
  return (
    <div className="space-y-6">
      {activeFilterCount > 0 && (
        <button
          onClick={onReset}
          className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-800"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Réinitialiser ({activeFilterCount})
        </button>
      )}

      {facets.categories.length > 0 && (
        <FilterGroup title="Type">
          {facets.categories.map((category) => (
            <CheckboxRow
              key={category.id}
              label={category.name}
              checked={selectedCategoryIds.includes(category.id)}
              onChange={() => onToggleCategory(category.id)}
            />
          ))}
        </FilterGroup>
      )}

      {facets.brands.length > 0 && (
        <FilterGroup title="Marque">
          {facets.brands.map((brand) => (
            <CheckboxRow
              key={brand.id}
              label={brand.name}
              checked={selectedBrandIds.includes(brand.id)}
              onChange={() => onToggleBrand(brand.id)}
            />
          ))}
        </FilterGroup>
      )}

      {facets.conditions.length > 0 && (
        <FilterGroup title="État">
          <div className="flex flex-wrap gap-2">
            {facets.conditions.map((condition) => {
              const active = selectedConditions.includes(condition);
              return (
                <button
                  key={condition}
                  onClick={() => onToggleCondition(condition)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                    active
                      ? 'bg-gray-900 text-white border-gray-900'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                  }`}
                >
                  {condition}
                </button>
              );
            })}
          </div>
        </FilterGroup>
      )}

      <FilterGroup title="Prix">
        <div className="space-y-1">
          {PRICE_BRACKETS.map((bracket) => (
            <label key={bracket.id} className="flex items-center gap-2 py-1 cursor-pointer text-sm text-gray-700">
              <input
                type="radio"
                name="price-bracket"
                checked={priceBracketId === bracket.id}
                onChange={() => onSelectPriceBracket(bracket.id)}
                className="h-3.5 w-3.5 text-gray-900 focus:ring-gray-400"
              />
              {bracket.label}
            </label>
          ))}
        </div>
      </FilterGroup>
    </div>
  );
};

const FilterGroup: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div>
    <h5 className="text-xs font-semibold text-gray-900 uppercase tracking-wide mb-3">{title}</h5>
    {children}
  </div>
);

const CheckboxRow: React.FC<{ label: string; checked: boolean; onChange: () => void }> = ({ label, checked, onChange }) => (
  <label className="flex items-center gap-2 py-1 cursor-pointer text-sm text-gray-700">
    <input
      type="checkbox"
      checked={checked}
      onChange={onChange}
      className="h-3.5 w-3.5 rounded border-gray-300 text-gray-900 focus:ring-gray-400"
    />
    {label}
  </label>
);

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
