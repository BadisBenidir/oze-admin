import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { B2BCatalogItem } from './useB2BCatalog';

interface UseB2BProductResult {
  product: B2BCatalogItem | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Charge un seul article du catalogue B2B par id — utilisé par la page
 * produit dédiée (accessible directement via son URL, donc sans dépendre de
 * la liste déjà chargée par useB2BCatalog).
 */
export const useB2BProduct = (productId: string | undefined, isAuthenticated: boolean = false): UseB2BProductResult => {
  const [product, setProduct] = useState<B2BCatalogItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProduct = useCallback(async () => {
    if (!productId || !isAuthenticated) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from('b2b_catalog')
        .select('*, brand:brands(id, name), category:categories(id, name)')
        .eq('id', productId)
        .maybeSingle();

      if (fetchError) {
        throw new Error(fetchError.message);
      }

      setProduct(data);
    } catch (err) {
      console.error('Erreur lors du chargement du produit B2B:', err);
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }, [productId, isAuthenticated]);

  useEffect(() => {
    fetchProduct();
  }, [fetchProduct]);

  return { product, loading, error, refresh: fetchProduct };
};
