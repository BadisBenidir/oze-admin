import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export interface DropProduct {
  id: string;
  name: string;
  product_code: string;
  images: string[];
  main_image_index: number;
  purchase_price: number | null;
  sale_price: number;
  status: string;
}

interface UseDropProductsResult {
  products: DropProduct[];
  loading: boolean;
  error: string | null;
}

/** Détail des articles d'un drop (prix d'achat/vente, statut) — chargé à la demande, à l'ouverture de sa fiche. */
export const useDropProducts = (productIds: string[] | null): UseDropProductsResult => {
  const [products, setProducts] = useState<DropProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchProducts = useCallback(async (ids: string[]) => {
    try {
      setLoading(true);
      setError(null);
      const { data, error: fetchError } = await supabase
        .from('products')
        .select('id, name, product_code, images, main_image_index, purchase_price, sale_price, status')
        .in('id', ids);

      if (fetchError) throw new Error(fetchError.message);
      // Conserve l'ordre d'origine du drop plutôt que l'ordre renvoyé par `in()`.
      const byId = new Map((data || []).map((p) => [p.id, p as DropProduct]));
      setProducts(ids.map((id) => byId.get(id)).filter((p): p is DropProduct => Boolean(p)));
    } catch (err) {
      console.error('Erreur lors du chargement des articles du drop:', err);
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!productIds || productIds.length === 0) {
      setProducts([]);
      return;
    }
    fetchProducts(productIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productIds?.join(',')]);

  return { products, loading, error };
};
