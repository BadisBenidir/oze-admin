import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';

export interface B2BCatalogItem {
  id: string;
  product_code: string;
  reference: string | null;
  b2b_reference: string | null;
  name: string;
  brand_id: string | null;
  category_id: string | null;
  genre: 'femme' | 'homme' | 'fille' | 'garcon';
  weight: number | null;
  images: string[];
  main_image_index: number;
  condition: string;
  description: string | null;
  defects: string | null;
  defect_images: string[] | null;
  colors: string[];
  material: string | null;
  status: string;
  created_at: string;
  price: number;
  held_by_other: boolean;
  brand?: { id: string; name: string };
  category?: { id: string; name: string };
}

export interface B2BCatalogFacetOption {
  id: string;
  name: string;
}

export interface B2BCatalogFacets {
  brands: B2BCatalogFacetOption[];
  categories: B2BCatalogFacetOption[];
  conditions: string[];
}

export interface B2BCatalogFilters {
  search: string;
  brandIds: string[];
  categoryIds: string[];
  conditions: string[];
  priceMin: number | null;
  priceMax: number | null;
}

const EMPTY_FILTERS: B2BCatalogFilters = {
  search: '',
  brandIds: [],
  categoryIds: [],
  conditions: [],
  priceMin: null,
  priceMax: null,
};

const EMPTY_FACETS: B2BCatalogFacets = { brands: [], categories: [], conditions: [] };

interface UseB2BCatalogResult {
  items: B2BCatalogItem[];
  loading: boolean;
  error: string | null;
  totalCount: number;
  currentPage: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  filters: B2BCatalogFilters;
  setFilters: (partial: Partial<B2BCatalogFilters>) => void;
  resetFilters: () => void;
  setPage: (page: number) => void;
  refresh: () => Promise<void>;
  facets: B2BCatalogFacets;
  facetsLoading: boolean;
}

const ITEMS_PER_PAGE = 24;

export const useB2BCatalog = (isAuthenticated: boolean = false): UseB2BCatalogResult => {
  const [items, setItems] = useState<B2BCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [filters, setFiltersState] = useState<B2BCatalogFilters>(EMPTY_FILTERS);
  const filtersRef = useRef(EMPTY_FILTERS);

  const [facets, setFacets] = useState<B2BCatalogFacets>(EMPTY_FACETS);
  const [facetsLoading, setFacetsLoading] = useState(true);

  const fetchItems = useCallback(async (page: number, currentFilters: B2BCatalogFilters) => {
    try {
      setLoading(true);
      setError(null);

      const from = (page - 1) * ITEMS_PER_PAGE;
      const to = from + ITEMS_PER_PAGE - 1;

      let query = supabase
        .from('b2b_catalog')
        .select('*, brand:brands(id, name), category:categories(id, name)', { count: 'exact' });

      if (currentFilters.search) {
        query = query.or(`name.ilike.%${currentFilters.search}%,product_code.ilike.%${currentFilters.search}%`);
      }
      if (currentFilters.brandIds.length > 0) {
        query = query.in('brand_id', currentFilters.brandIds);
      }
      if (currentFilters.categoryIds.length > 0) {
        query = query.in('category_id', currentFilters.categoryIds);
      }
      if (currentFilters.conditions.length > 0) {
        query = query.in('condition', currentFilters.conditions);
      }
      if (currentFilters.priceMin !== null) {
        query = query.gte('price', currentFilters.priceMin);
      }
      if (currentFilters.priceMax !== null) {
        query = query.lte('price', currentFilters.priceMax);
      }

      const { data, count, error: fetchError } = await query
        .order('created_at', { ascending: false })
        .range(from, to);

      if (fetchError) {
        throw new Error(fetchError.message);
      }

      setItems(data || []);
      setTotalCount(count || 0);
    } catch (err) {
      console.error('Erreur lors du chargement du catalogue B2B:', err);
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }, []);

  // Facettes (marques/catégories/états réellement présentes dans le catalogue
  // B2B) chargées une seule fois, indépendamment des filtres actifs, pour que
  // la liste des cases à cocher ne se réduise pas au fil des sélections.
  const fetchFacets = useCallback(async () => {
    try {
      setFacetsLoading(true);
      const { data, error: fetchError } = await supabase
        .from('b2b_catalog')
        .select('brand:brands(id, name), category:categories(id, name), condition');

      if (fetchError) throw new Error(fetchError.message);

      const brandMap = new Map<string, string>();
      const categoryMap = new Map<string, string>();
      const conditionSet = new Set<string>();

      for (const row of data || []) {
        const brand = row.brand as unknown as B2BCatalogFacetOption | null;
        const category = row.category as unknown as B2BCatalogFacetOption | null;
        if (brand) brandMap.set(brand.id, brand.name);
        if (category) categoryMap.set(category.id, category.name);
        if (row.condition) conditionSet.add(row.condition as string);
      }

      setFacets({
        brands: [...brandMap.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
        categories: [...categoryMap.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
        conditions: [...conditionSet].sort(),
      });
    } catch (err) {
      console.error('Erreur lors du chargement des filtres du catalogue B2B:', err);
    } finally {
      setFacetsLoading(false);
    }
  }, []);

  const setFilters = (partial: Partial<B2BCatalogFilters>) => {
    const next = { ...filtersRef.current, ...partial };
    filtersRef.current = next;
    setFiltersState(next);
    setCurrentPage(1);
    if (isAuthenticated) {
      fetchItems(1, next);
    }
  };

  const resetFilters = () => {
    filtersRef.current = EMPTY_FILTERS;
    setFiltersState(EMPTY_FILTERS);
    setCurrentPage(1);
    if (isAuthenticated) {
      fetchItems(1, EMPTY_FILTERS);
    }
  };

  const setPage = (page: number) => {
    setCurrentPage(page);
    if (isAuthenticated) {
      fetchItems(page, filtersRef.current);
    }
  };

  const refresh = async () => {
    await fetchItems(currentPage, filtersRef.current);
  };

  const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE);

  useEffect(() => {
    if (!isAuthenticated) {
      setLoading(false);
      setFacetsLoading(false);
      return;
    }
    fetchItems(currentPage, filtersRef.current);
    fetchFacets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, fetchItems, fetchFacets]);

  return {
    items,
    loading,
    error,
    totalCount,
    currentPage,
    totalPages,
    hasNextPage: currentPage < totalPages,
    hasPreviousPage: currentPage > 1,
    filters,
    setFilters,
    resetFilters,
    setPage,
    refresh,
    facets,
    facetsLoading,
  };
};
