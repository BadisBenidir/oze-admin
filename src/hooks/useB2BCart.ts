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

/** Durée de la session de réservation affichée au revendeur avant expiration du panier. */
const CART_SESSION_MS = 15 * 60 * 1000;

const toCartItem = (product: B2BCatalogItem): B2BCartItem => ({
  id: product.id,
  name: product.name,
  product_code: product.product_code,
  image: product.images?.[product.main_image_index] || product.images?.[0] || null,
  price: product.price,
});

export const useB2BCart = (resellerId: string | undefined) => {
  // Deux clés séparées et volontairement indépendantes : le panier survit à
  // une expiration ratée côté anti-spam, l'expiration se recalcule seule si
  // le panier a été vidé ailleurs. Scopées par revendeur pour ne pas mélanger
  // deux sessions sur un même navigateur.
  const cartKey = resellerId ? `b2b_cart_${resellerId}` : null;
  const expirationKey = resellerId ? `oze_cart_expiration_${resellerId}` : null;

  const [items, setItems] = useState<B2BCartItem[]>([]);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  // Signal ponctuel : le panier a été vidé automatiquement au chargement de
  // la page car le délai de réservation était déjà écoulé pendant que la
  // page était fermée/rechargée. Le composant appelant (CartPage) l'observe
  // pour déclencher immédiatement la redirection + le message d'expiration.
  const [expiredOnLoad, setExpiredOnLoad] = useState(false);

  useEffect(() => {
    setExpiredOnLoad(false);

    if (!cartKey || !expirationKey) {
      setItems([]);
      setExpiresAt(null);
      return;
    }

    let loadedItems: B2BCartItem[] = [];
    try {
      const rawCart = localStorage.getItem(cartKey);
      if (rawCart) {
        const parsed = JSON.parse(rawCart);
        // Rétrocompatibilité : une ancienne version stockait { items, expiresAt }
        // dans la même clé que le panier.
        loadedItems = Array.isArray(parsed) ? parsed : (parsed.items ?? []);
      }
    } catch {
      loadedItems = [];
    }

    if (loadedItems.length === 0) {
      setItems([]);
      setExpiresAt(null);
      localStorage.removeItem(expirationKey);
      return;
    }

    const rawExpiration = localStorage.getItem(expirationKey);
    let expirationTimestamp = rawExpiration ? parseInt(rawExpiration, 10) : NaN;

    if (!rawExpiration || isNaN(expirationTimestamp)) {
      // Panier non vide mais aucune expiration enregistrée (premier chargement
      // après cette mise à jour, ou clé perdue) : on démarre une session fraîche.
      expirationTimestamp = Date.now() + CART_SESSION_MS;
      localStorage.setItem(expirationKey, String(expirationTimestamp));
    }

    const remainingMs = expirationTimestamp - Date.now();

    if (remainingMs <= 0) {
      // Le temps est passé pendant que la page était fermée/rechargée : on
      // nettoie immédiatement plutôt que d'attendre le premier tick du timer.
      localStorage.removeItem(cartKey);
      localStorage.removeItem(expirationKey);
      setItems([]);
      setExpiresAt(null);
      setExpiredOnLoad(true);
      return;
    }

    setItems(loadedItems);
    setExpiresAt(expirationTimestamp);
  }, [cartKey, expirationKey]);

  const persistItems = (nextItems: B2BCartItem[]) => {
    setItems(nextItems);
    if (!cartKey || !expirationKey) return;

    if (nextItems.length === 0) {
      localStorage.removeItem(cartKey);
      localStorage.removeItem(expirationKey);
      setExpiresAt(null);
      return;
    }

    localStorage.setItem(cartKey, JSON.stringify(nextItems));

    // Le compte à rebours court pour toute la session panier, pas par
    // article : on ne (re)calcule une expiration que s'il n'y en a pas déjà
    // une valide en localStorage.
    const rawExpiration = localStorage.getItem(expirationKey);
    const existing = rawExpiration ? parseInt(rawExpiration, 10) : NaN;
    if (!rawExpiration || isNaN(existing) || existing <= Date.now()) {
      const fresh = Date.now() + CART_SESSION_MS;
      localStorage.setItem(expirationKey, String(fresh));
      setExpiresAt(fresh);
    } else {
      setExpiresAt(existing);
    }
  };

  const addItem = (product: B2BCatalogItem) => {
    if (items.some((i) => i.id === product.id)) return;
    persistItems([...items, toCartItem(product)]);
  };

  const removeItem = (id: string) => {
    persistItems(items.filter((i) => i.id !== id));
  };

  const clear = () => persistItems([]);

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
      persistItems(items.filter((i) => !unavailableIds.includes(i.id)));
    }

    if (!data?.url) {
      return { success: false, error: 'Réponse de paiement invalide' };
    }

    window.location.href = data.url;
    return { success: true };
  };

  return { items, expiresAt, expiredOnLoad, addItem, removeItem, clear, isInCart, subtotal, startCheckout };
};
