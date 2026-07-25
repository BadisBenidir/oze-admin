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
 * Charge un seul article par id — utilisé par la page produit dédiée
 * (accessible directement via son URL, donc sans dépendre de la liste déjà
 * chargée par useB2BCatalog). Interroge `b2b_reseller_product_detail`, PAS
 * `b2b_catalog` : cette vue autorise aussi un produit déjà commandé par ce
 * revendeur même si son statut a changé depuis (vendu, cadeau livré...),
 * pour que les liens "voir le produit" depuis l'historique de commandes
 * restent valides. `b2b_catalog`, lui, ne renvoie JAMAIS un produit qui
 * n'est pas actuellement en vente — ne pas revenir dessus ici (voir 0042).
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
        .from('b2b_reseller_product_detail')
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
