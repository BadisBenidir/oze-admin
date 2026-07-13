import { useState, useEffect } from 'react';
import { B2BCatalogItem } from './useB2BCatalog';
import { invokeEdgeFunction } from '../utils/invokeEdgeFunction';

export interface B2BCartItem {
  id: string;
  name: string;
  product_code: string;
  image: string | null;
  price: number;
}

interface CheckoutResult {
  success: boolean;
  error?: string;
  unavailableIds?: string[];
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

  /**
   * Crée une session de paiement Stripe et redirige immédiatement vers la
   * page de paiement hébergée par Stripe. La commande n'est créée qu'après
   * confirmation du paiement (webhook côté serveur) — le panier local n'est
   * donc volontairement PAS vidé ici, seulement au retour en cas de succès.
   */
  const startCheckout = async (
    shippingAddress: Record<string, unknown>,
    billingAddress?: Record<string, unknown>
  ): Promise<CheckoutResult> => {
    if (items.length === 0) {
      return { success: false, error: 'Le panier est vide' };
    }

    const { data, error } = await invokeEdgeFunction<{ url: string; unavailable_ids?: string[] }>('b2b-checkout', {
      product_ids: items.map((i) => i.id),
      shipping_address: shippingAddress,
      billing_address: billingAddress,
    });

    if (error) {
      return { success: false, error };
    }

    if (data?.unavailable_ids?.length) {
      const unavailableIds = data.unavailable_ids;
      persist(items.filter((i) => !unavailableIds.includes(i.id)));
    }

    if (!data?.url) {
      return { success: false, error: 'Réponse de paiement invalide' };
    }

    window.location.href = data.url;
    return { success: true };
  };

  return { items, addItem, removeItem, clear, isInCart, subtotal, startCheckout };
};
