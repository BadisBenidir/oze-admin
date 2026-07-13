import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';

export interface B2BCatalogItem {
  id: string;
  product_code: string;
  reference: string | null;
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
  brand?: { id: string; name: string };
  category?: { id: string; name: string };
}

interface UseB2BCatalogResult {
  items: B2BCatalogItem[];
  loading: boolean;
  error: string | null;
  totalCount: number;
  currentPage: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  search: string;
  setSearch: (value: string) => void;
  setPage: (page: number) => void;
  refresh: () => Promise<void>;
}

const ITEMS_PER_PAGE = 24;

export const useB2BCatalog = (isAuthenticated: boolean = false): UseB2BCatalogResult => {
  const [items, setItems] = useState<B2BCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [search, setSearchState] = useState('');
  const searchRef = useRef('');

  const fetchItems = useCallback(async (page: number, currentSearch: string) => {
    try {
      setLoading(true);
      setError(null);

      const from = (page - 1) * ITEMS_PER_PAGE;
      const to = from + ITEMS_PER_PAGE - 1;

      let query = supabase
        .from('b2b_catalog')
        .select('*, brand:brands(id, name), category:categories(id, name)', { count: 'exact' });

      if (currentSearch) {
        query = query.or(`name.ilike.%${currentSearch}%,product_code.ilike.%${currentSearch}%`);
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

  const setSearch = (value: string) => {
    searchRef.current = value;
    setSearchState(value);
    setCurrentPage(1);
    if (isAuthenticated) {
      fetchItems(1, value);
    }
  };

  const setPage = (page: number) => {
    setCurrentPage(page);
    if (isAuthenticated) {
      fetchItems(page, searchRef.current);
    }
  };

  const refresh = async () => {
    await fetchItems(currentPage, searchRef.current);
  };

  const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE);

  useEffect(() => {
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }
    fetchItems(currentPage, searchRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, fetchItems]);

  return {
    items,
    loading,
    error,
    totalCount,
    currentPage,
    totalPages,
    hasNextPage: currentPage < totalPages,
    hasPreviousPage: currentPage > 1,
    search,
    setSearch,
    setPage,
    refresh,
  };
};
