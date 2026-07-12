import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { B2BCatalogItem } from './useB2BCatalog';

export interface B2BCartItem {
  id: string;
  name: string;
  product_code: string;
  image: string | null;
  price: number;
}

interface SubmitResult {
  success: boolean;
  error?: string;
  unavailableIds?: string[];
  orderNumber?: string;
}

const toCartItem = (product: B2BCatalogItem): B2BCartItem => ({
  id: product.id,
  name: product.name,
  product_code: product.product_code,
  image: product.images?.[product.main_image_index] || product.images?.[0] || null,
  price: product.price,
});

export const useB2BCart = (resellerId: string | undefined) => {
  const storageKey = resellerId ? `b2b_cart_${resellerId}` : null;
  const [items, setItems] = useState<B2BCartItem[]>([]);

  useEffect(() => {
    if (!storageKey) {
      setItems([]);
      return;
    }
    try {
      const raw = localStorage.getItem(storageKey);
      setItems(raw ? JSON.parse(raw) : []);
    } catch {
      setItems([]);
    }
  }, [storageKey]);

  const persist = (next: B2BCartItem[]) => {
    setItems(next);
    if (storageKey) {
      localStorage.setItem(storageKey, JSON.stringify(next));
    }
  };

  const addItem = (product: B2BCatalogItem) => {
    if (items.some((i) => i.id === product.id)) return;
    persist([...items, toCartItem(product)]);
  };

  const removeItem = (id: string) => {
    persist(items.filter((i) => i.id !== id));
  };

  const clear = () => persist([]);

  const isInCart = (id: string) => items.some((i) => i.id === id);

  const subtotal = items.reduce((sum, i) => sum + i.price, 0);

  const submitOrder = async (shippingAddress: Record<string, unknown>): Promise<SubmitResult> => {
    if (items.length === 0) {
      return { success: false, error: 'Le panier est vide' };
    }

    const { data, error } = await supabase.rpc('submit_b2b_order', {
      p_product_ids: items.map((i) => i.id),
      p_shipping_address: shippingAddress,
    });

    if (error) {
      const match = error.message.match(/B2B_UNAVAILABLE_ITEMS:(\[.*\])/);
      if (match) {
        try {
          const unavailableIds: string[] = JSON.parse(match[1]);
          persist(items.filter((i) => !unavailableIds.includes(i.id)));
          return {
            success: false,
            error: 'Certains articles ont été achetés entre-temps et ont été retirés de votre panier. Vérifiez et soumettez à nouveau.',
            unavailableIds,
          };
        } catch {
          // format inattendu, on retombe sur le message brut ci-dessous
        }
      }
      return { success: false, error: error.message };
    }

    clear();
    return { success: true, orderNumber: data?.order_number };
  };

  return { items, addItem, removeItem, clear, isInCart, subtotal, submitOrder };
};
