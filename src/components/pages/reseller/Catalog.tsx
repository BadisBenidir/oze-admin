import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '../../ui/Badge';
import { supabase } from '../../../lib/supabase';
import { useResellerAuth } from '../../../hooks/useResellerAuth';
import { useB2BCatalog, B2BCatalogItem, B2BCatalogSort } from '../../../hooks/useB2BCatalog';
import { useB2BCart } from '../../../hooks/useB2BCart';
// ⚠️ `cart` doit toujours venir de l'instance unique créée dans ResellerApp
// et reçue ici en prop, jamais d'un nouvel appel local à useB2BCart() : deux
// instances = deux états séparés qui écrivent le même localStorage sans se
// notifier l'une l'autre. C'est ce qui causait un panier "ajouté" qui ne se
// reflétait dans le badge/la page panier qu'après rechargement complet.
import { GRADE_VARIANTS, isGrade } from '../../../utils/productGrade';
import { DropPreviewBadge } from './DropPreviewBadge';
import { ScheduleAnnouncement } from './ScheduleAnnouncement';

interface NextDropAnnouncement {
  drop_id: string;
  title: string | null;
  scheduled_at: string;
  piece_count: number;
  brands: string[];
  preview_images: string[];
  /** Nombre de photos nettes en tête de preview_images (pièces vitrine, 0171). */
  revealed_count?: number;
}
import {
  Search,
  ShoppingCart,
  ImageOff,
  Check,
  Package,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Clock,
  Eye,
  RotateCcw,
  Zap,
  Lock,
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
  /** Onglet « Achat immédiat » (0253) : mêmes cartes et même panier. */
  instantBuy?: boolean;
}

export const Catalog: React.FC<CatalogProps> = ({ cart, onOpenProduct, instantBuy = false }) => {
  const { isReseller } = useResellerAuth();
  const {
    items,
    loading,
    error,
    totalCount,
    currentPage,
    totalPages,
    hasNextPage,
    hasPreviousPage,
    filters,
    setFilters,
    resetFilters,
    setPage,
    facets,
    refreshSilently,
  } = useB2BCatalog(isReseller, instantBuy);

  // Le statut "Dans un panier" d'un article (held_by_other) dépend de la
  // réservation exclusive d'un AUTRE revendeur (cart_items) : product_
  // reservation_signals (une table dédiée, sans user_id, lisible par tout
  // revendeur actif — voir 0084_realtime_held_by_other.sql) porte le signal
  // en Realtime, car cart_items lui-même a une RLS stricte qui empêcherait
  // tout abonnement direct de voir les réservations des AUTRES utilisateurs.
  // Un debounce évite une rafale de refetch si plusieurs signaux arrivent
  // en quelques millisecondes (plusieurs revendeurs actifs en même temps).
  // Toujours en silencieux : un rechargement visible remplaçait la grille par
  // des squelettes, la page raccourcissait et le mobile remontait tout en haut.
  const refreshRef = useRef(refreshSilently);
  refreshRef.current = refreshSilently;

  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => refreshRef.current(), 400);
    };

    const channel = supabase
      .channel(instantBuy ? 'instant-buy-reservation-signals' : 'catalog-reservation-signals')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'product_reservation_signals' }, scheduleRefresh)
      .subscribe();

    // Filet de sécurité si la connexion Realtime se coupe (veille de
    // l'onglet, réseau instable...) — bien plus espacé qu'avant puisque ce
    // n'est plus le mécanisme principal de mise à jour.
    const fallbackInterval = setInterval(refreshRef.current, 60000);

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      clearInterval(fallbackInterval);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Achat immédiat bloqué par l'admin (0254) : cadenas + message, aucun article.
  const [lock, setLock] = useState<{ locked: boolean; message: string | null } | null>(null);
  useEffect(() => {
    if (!instantBuy) return;
    supabase.rpc('get_instant_buy_lock').then(({ data, error: lockError }) => {
      const row = data as { locked?: boolean; message?: string | null } | null;
      setLock(lockError ? { locked: false, message: null } : { locked: Boolean(row?.locked), message: row?.message ?? null });
    });
  }, [instantBuy]);

  // Annonce du prochain drop programmé (0168) — silencieuse en cas d'erreur
  // (fonction absente avant migration) : pas de bandeau, rien d'autre.
  const [nextDrop, setNextDrop] = useState<NextDropAnnouncement | null>(null);
  const loadNextDrop = async () => {
    const { data, error } = await supabase.rpc('get_next_drop_announcement');
    if (error) return;
    const row = (Array.isArray(data) ? data[0] : data) as NextDropAnnouncement | undefined;
    setNextDrop(row && row.scheduled_at ? row : null);
  };
  useEffect(() => {
    if (!instantBuy) loadNextDrop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeFilterCount =
    filters.brandIds.length +
    filters.categoryIds.length +
    filters.conditions.length +
    (filters.priceMin !== null || filters.priceMax !== null ? 1 : 0);
  const hasActiveFilters = activeFilterCount > 0 || Boolean(filters.search);

  const currentPriceBracket = useMemo(
    () => priceBracketId(filters.priceMin, filters.priceMax),
    [filters.priceMin, filters.priceMax]
  );

  // Retour en haut de la grille au changement de page (comme Résultats de ventes).
  const topRef = useRef<HTMLDivElement>(null);
  const goToPage = (page: number) => {
    setPage(page);
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const selectClass =
    'rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-700 focus:border-gray-400 focus:outline-none';
  const pagerButton =
    'flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-white';

  const pager =
    !loading && totalPages > 1 ? (
      <div className="flex items-center justify-center gap-2">
        <button onClick={() => goToPage(1)} disabled={!hasPreviousPage} className={pagerButton} title="Première page">
          <ChevronsLeft className="h-4 w-4" />
        </button>
        <button onClick={() => goToPage(currentPage - 1)} disabled={!hasPreviousPage} className={pagerButton} title="Page précédente">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="px-3 text-sm text-gray-600">
          Page <span className="font-semibold text-gray-900">{currentPage}</span> / {totalPages}
        </span>
        <button onClick={() => goToPage(currentPage + 1)} disabled={!hasNextPage} className={pagerButton} title="Page suivante">
          <ChevronRight className="h-4 w-4" />
        </button>
        <button onClick={() => goToPage(totalPages)} disabled={!hasNextPage} className={pagerButton} title="Dernière page">
          <ChevronsRight className="h-4 w-4" />
        </button>
      </div>
    ) : null;

  if (instantBuy && lock?.locked) {
    return (
      <div className="mx-auto flex max-w-[1600px] flex-col items-center justify-center p-4 py-24 text-center md:p-6 md:py-32">
        <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-gray-900">
          <Lock className="h-9 w-9 text-white" />
        </div>
        <h2 className="text-2xl font-semibold text-gray-900">Achat immédiat</h2>
        <p className="mt-3 max-w-md whitespace-pre-line text-gray-600">{lock.message || 'Aucun article disponible pour le moment.'}</p>
        <p className="mt-2 text-sm text-gray-400">Revenez bientôt, de nouvelles pièces arrivent régulièrement.</p>
      </div>
    );
  }

  return (
    <div ref={topRef} className="mx-auto max-w-[1600px] scroll-mt-24 space-y-5 p-4 md:p-6">
      {nextDrop && (
        <ScheduleAnnouncement
          kind="drop"
          title={nextDrop.title}
          startsAt={nextDrop.scheduled_at}
          pieceCount={nextDrop.piece_count}
          brands={nextDrop.brands}
          images={nextDrop.preview_images}
          revealedCount={nextDrop.revealed_count ?? 0}
          onStart={() => {
            // Le drop vient d'être publié : on recharge le catalogue puis l'annonce.
            setTimeout(() => {
              refreshRef.current();
              loadNextDrop();
            }, 5000);
          }}
        />
      )}

      <div>
        <h2 className="flex items-center gap-2 text-xl font-semibold text-gray-900">
          {instantBuy && <Zap className="h-5 w-5" />}
          {instantBuy ? 'Achat immédiat' : 'Catalogue'}
        </h2>
        <p className="text-sm text-gray-500">
          {instantBuy
            ? 'Pièces disponibles tout de suite, sans attendre un drop : ajoutez au panier et payez.'
            : 'Les pièces en vente, réservées aux membres du Club.'}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            value={filters.search}
            onChange={(e) => setFilters({ search: e.target.value })}
            placeholder="Rechercher (modèle, marque, référence…)"
            className="w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-9 pr-3 text-sm focus:border-gray-400 focus:outline-none"
          />
        </div>
        <select
          value={filters.categoryIds[0] || ''}
          onChange={(e) => setFilters({ categoryIds: e.target.value ? [e.target.value] : [] })}
          className={selectClass}
        >
          <option value="">Toutes les catégories</option>
          {facets.categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select
          value={filters.brandIds[0] || ''}
          onChange={(e) => setFilters({ brandIds: e.target.value ? [e.target.value] : [] })}
          className={selectClass}
        >
          <option value="">Toutes les marques</option>
          {facets.brands.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
        <select
          value={filters.conditions[0] || ''}
          onChange={(e) => setFilters({ conditions: e.target.value ? [e.target.value] : [] })}
          className={selectClass}
        >
          <option value="">Tous les états</option>
          {facets.conditions.map((c) => (
            <option key={c} value={c}>État {c}</option>
          ))}
        </select>
        <select
          value={currentPriceBracket}
          onChange={(e) => {
            const bracket = PRICE_BRACKETS.find((b) => b.id === e.target.value) ?? PRICE_BRACKETS[0];
            setFilters({ priceMin: bracket.min, priceMax: bracket.max });
          }}
          className={selectClass}
        >
          {PRICE_BRACKETS.map((b) => (
            <option key={b.id} value={b.id}>{b.label}</option>
          ))}
        </select>
        <select value={filters.sort} onChange={(e) => setFilters({ sort: e.target.value as B2BCatalogSort })} className={selectClass}>
          <option value="recent">Nouveautés</option>
          <option value="price_asc">Prix croissant</option>
          <option value="price_desc">Prix décroissant</option>
        </select>
      </div>

      <div className="flex min-h-[40px] flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-600">
          {loading ? 'Chargement…' : `${totalCount} pièce${totalCount > 1 ? 's' : ''} disponible${totalCount > 1 ? 's' : ''}`}
        </p>
        {hasActiveFilters && (
          <button onClick={resetFilters} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900">
            <RotateCcw className="h-3.5 w-3.5" /> Réinitialiser les filtres
          </button>
        )}
      </div>

      {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">Erreur : {error}</p>}

      {!loading && !error && items.length === 0 && (
        <div className="rounded-xl border border-gray-200 bg-white py-12 text-center">
          <Package className="mx-auto mb-4 h-12 w-12 text-gray-300" />
          <h3 className="mb-2 text-lg font-medium text-gray-900">Aucun article disponible</h3>
          <p className="text-sm text-gray-500">
            {hasActiveFilters
              ? "Essayez d'élargir votre recherche ou vos filtres."
              : instantBuy
                ? 'De nouvelles pièces en achat immédiat arrivent régulièrement.'
                : 'Revenez bientôt, de nouvelles pièces arrivent régulièrement.'}
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {loading
          ? [...Array(10)].map((_, i) => (
              <div key={`skeleton-${i}`} className="overflow-hidden rounded-xl border border-gray-200 bg-white">
                <div className="aspect-square animate-pulse bg-gray-100" />
                <div className="space-y-2 p-4">
                  <div className="mx-auto h-4 w-24 animate-pulse rounded bg-gray-100" />
                  <div className="h-4 animate-pulse rounded bg-gray-100" />
                  <div className="h-9 animate-pulse rounded-lg bg-gray-100" />
                </div>
              </div>
            ))
          : items.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                inCart={!product.sold_at && cart.isInCart(product.id)}
                onAdd={async () => {
                  const result = await cart.addItem(product);
                  // Un autre utilisateur (même collègue) vient de réserver ce
                  // produit entre-temps : rafraîchissement immédiat, pour que
                  // la carte passe tout de suite en « Dans un panier ».
                  if (!result.success) refreshSilently();
                  return result;
                }}
                onView={() => onOpenProduct(product.id)}
              />
            ))}
      </div>

      {pager}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Sous-composants
// ---------------------------------------------------------------------------

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

  const isDropPreview = product.status === 'draft' && Boolean(product.drop_preview_scheduled_at);
  const sold = Boolean(product.sold_at);
  const held = !sold && product.held_by_other && !inCart;
  const disabled = sold || adding || inCart || held;
  const hasDiscount = Boolean(product.original_price && product.original_price > product.price);
  const discountPercent = hasDiscount ? Math.round((1 - product.price / product.original_price!) * 100) : 0;

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
    <div
      onClick={sold ? undefined : onView}
      className={`flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white transition-shadow ${
        sold ? 'cursor-default opacity-60 grayscale' : 'cursor-pointer hover:shadow-md'
      }`}
    >
      <div className="relative aspect-square bg-gray-50">
        {image ? (
          <img src={image} alt={product.name} loading="lazy" className={`h-full w-full object-cover ${held ? 'opacity-30' : ''}`} />
        ) : (
          <div className="flex h-full items-center justify-center">
            <ImageOff className="h-8 w-8 text-gray-300" />
          </div>
        )}
        {hasDiscount && (
          <span className="absolute left-2 top-2 rounded-full bg-red-600 px-2.5 py-1 text-xs font-semibold text-white">-{discountPercent}%</span>
        )}
        {isDropPreview && (
          <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-gray-900/90 px-2.5 py-1 text-[11px] font-semibold text-white">
            <Eye className="h-3 w-3" />
            Avant-première
          </span>
        )}
        {sold && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="rounded-full bg-gray-900 px-3 py-1 text-sm font-semibold uppercase tracking-wide text-white">Vendu</span>
          </div>
        )}
        {held && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="flex items-center gap-1 rounded-full bg-gray-900 px-2.5 py-1 text-xs font-medium text-white">
              <Clock className="h-3 w-3" />
              Dans un panier
            </span>
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-4 text-sm">
        <div className="flex min-h-[1.25rem] justify-end">
          {isGrade(product.condition) ? (
            <Badge variant={GRADE_VARIANTS[product.condition]}>État {product.condition}</Badge>
          ) : (
            product.condition && <span className="text-gray-500">État {product.condition}</span>
          )}
        </div>
        <p className="mt-1 text-center text-base font-semibold uppercase tracking-[0.2em] text-gray-900">{product.brand?.name || '—'}</p>
        <p className="line-clamp-2 min-h-[2.5rem] text-center text-gray-600">{product.name}</p>
        <div className="mt-auto space-y-2 border-t border-gray-100 pt-2">
          <div className="flex items-baseline justify-center gap-2">
            <span className="text-lg font-semibold text-gray-900">{product.price.toFixed(0)} €</span>
            {hasDiscount && <span className="text-sm text-gray-400 line-through">{product.original_price!.toFixed(0)} €</span>}
          </div>
          {isDropPreview ? (
            <DropPreviewBadge scheduledAt={product.drop_preview_scheduled_at!} compact />
          ) : (
            <>
              <button
                onClick={handleAdd}
                disabled={disabled}
                className={`flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  inCart
                    ? 'cursor-default bg-green-50 text-green-700'
                    : disabled
                      ? 'cursor-not-allowed bg-gray-100 text-gray-400'
                      : 'bg-gray-900 text-white hover:bg-gray-800'
                }`}
              >
                {sold ? (
                  <span>Vendu</span>
                ) : inCart ? (
                  <>
                    <Check className="h-4 w-4" />
                    <span>Dans le panier</span>
                  </>
                ) : held ? (
                  <>
                    <Clock className="h-4 w-4" />
                    <span>Dans un panier</span>
                  </>
                ) : (
                  <>
                    <ShoppingCart className="h-4 w-4" />
                    <span>{adding ? 'Ajout…' : 'Ajouter au panier'}</span>
                  </>
                )}
              </button>
              {addError && <p className="text-center text-xs text-red-600">{addError}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
