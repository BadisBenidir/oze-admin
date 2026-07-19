import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { B2BCatalogItem } from './useB2BCatalog';
import { invokeEdgeFunction } from '../utils/invokeEdgeFunction';
import { DeliveryType } from '../components/pages/reseller/ShippingForm';
import { ChronopostPickupPoint } from '../services/chronopostService';

export interface B2BCartItem {
  id: string;
  name: string;
  product_code: string;
  image: string | null;
  price: number;
  /** Horodatage d'ajout : sert de base au chrono de 15 min, indépendant par article. */
  added_at: number;
  /** Assurance Sendcloud optionnelle, 0.6% de la valeur de l'article. */
  insured: boolean;
}

/** Taux d'assurance Sendcloud (0.6% de la valeur de l'article). Recalculé
 * côté serveur dans b2b-checkout — jamais accepté tel quel du client. */
export const INSURANCE_RATE = 0.006;

interface CheckoutResult {
  success: boolean;
  error?: string;
  unavailableIds?: string[];
}

interface AddItemResult {
  success: boolean;
  error?: string;
}

/**
 * Verrou logiciel best-effort (pas la réservation réelle de l'inventaire,
 * toujours faite atomiquement au paiement) : signale aux autres revendeurs
 * que l'article est dans un panier actif. Échec silencieux volontaire côté
 * release — un hold orphelin expire de lui-même sous 15 min.
 */
const releaseHold = (productId: string) => {
  supabase.rpc('release_b2b_cart_item', { p_product_id: productId }).then(({ error }) => {
    if (error) console.error('Erreur lors de la libération du verrou panier:', error);
  });
};

/** Durée de réservation par article, indépendante pour chacun (aligné sur le hold serveur, voir hold_b2b_cart_item). */
export const CART_ITEM_SESSION_MS = 15 * 60 * 1000;

const toCartItem = (product: B2BCatalogItem): B2BCartItem => ({
  id: product.id,
  name: product.name,
  product_code: product.product_code,
  image: product.images?.[product.main_image_index] || product.images?.[0] || null,
  price: product.price,
  added_at: Date.now(),
  insured: false,
});

const isExpired = (item: B2BCartItem) => item.added_at + CART_ITEM_SESSION_MS <= Date.now();

export const useB2BCart = (profileId: string | undefined) => {
  // Scopée par PROFIL INDIVIDUEL, pas par entreprise/reseller_id : deux
  // collègues d'un même revendeur (ex. le contact principal et un
  // sous-compte invité) ont chacun leur propre panier, leur propre adresse
  // et leur propre paiement — reseller_id est partagé entre eux, profile.id
  // ne l'est jamais (contrainte unique sur reseller_contacts.profile_id).
  const cartKey = profileId ? `b2b_cart_${profileId}` : null;

  const [items, setItems] = useState<B2BCartItem[]>([]);
  // Noms des articles retirés automatiquement (chrono écoulé), affichés
  // transitoirement par CartPage puis effacés — purement informatif, ne
  // bloque rien.
  const [recentlyExpiredNames, setRecentlyExpiredNames] = useState<string[]>([]);
  const itemsRef = useRef<B2BCartItem[]>([]);
  itemsRef.current = items;

  const write = (nextItems: B2BCartItem[]) => {
    setItems(nextItems);
    if (!cartKey) return;
    if (nextItems.length === 0) {
      localStorage.removeItem(cartKey);
    } else {
      localStorage.setItem(cartKey, JSON.stringify(nextItems));
    }
  };

  // Charge le panier au montage / changement de revendeur, en retirant
  // immédiatement (et individuellement) tout article dont le chrono de 15
  // min est déjà écoulé — par ex. si l'onglet est resté fermé longtemps.
  useEffect(() => {
    setRecentlyExpiredNames([]);

    if (!cartKey) {
      setItems([]);
      return;
    }

    let loadedItems: B2BCartItem[] = [];
    try {
      const raw = localStorage.getItem(cartKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        // Rétrocompatibilité : anciennes versions stockaient un objet
        // { items, expiresAt } ou des articles sans added_at (chrono
        // partagé pour tout le panier) — on démarre alors un chrono neuf
        // par article plutôt que de les considérer expirés d'office.
        const rawItems: unknown[] = Array.isArray(parsed) ? parsed : (parsed?.items ?? []);
        loadedItems = rawItems.map((raw) => {
          const it = raw as Partial<B2BCartItem>;
          return {
            ...it,
            added_at: typeof it.added_at === 'number' ? it.added_at : Date.now(),
            insured: it.insured === true,
          } as B2BCartItem;
        });
      }
    } catch {
      loadedItems = [];
    }

    const stillValid = loadedItems.filter((i) => !isExpired(i));
    const expired = loadedItems.filter((i) => isExpired(i));

    if (expired.length > 0) {
      expired.forEach((i) => releaseHold(i.id));
      setRecentlyExpiredNames(expired.map((i) => i.name));
    }

    write(stillValid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartKey]);

  // Vérifie chaque seconde si un article a atteint son propre chrono de 15
  // min : si oui, seul CET article est retiré (et son hold libéré), le
  // reste du panier n'est pas affecté.
  useEffect(() => {
    const interval = setInterval(() => {
      const current = itemsRef.current;
      if (current.length === 0) return;

      const expired = current.filter(isExpired);
      if (expired.length === 0) return;

      expired.forEach((i) => releaseHold(i.id));
      setRecentlyExpiredNames(expired.map((i) => i.name));
      write(current.filter((i) => !isExpired(i)));
    }, 1000);

    return () => clearInterval(interval);
  }, [cartKey]);

  const addItem = async (product: B2BCatalogItem): Promise<AddItemResult> => {
    if (items.some((i) => i.id === product.id)) return { success: true };

    // Pose le verrou côté serveur AVANT d'ajouter localement : si un autre
    // revendeur a déjà cet article dans son panier, la fonction refuse.
    const { error } = await supabase.rpc('hold_b2b_cart_item', { p_product_id: product.id });
    if (error) {
      return { success: false, error: error.message };
    }

    write([...items, toCartItem(product)]);
    return { success: true };
  };

  const removeItem = (id: string) => {
    write(items.filter((i) => i.id !== id));
    releaseHold(id);
  };

  const clear = () => {
    items.forEach((i) => releaseHold(i.id));
    write([]);
  };

  const isInCart = (id: string) => items.some((i) => i.id === id);

  const toggleInsurance = (id: string) => {
    write(items.map((i) => (i.id === id ? { ...i, insured: !i.insured } : i)));
  };

  const subtotal = items.reduce((sum, i) => sum + i.price, 0);
  const insuranceTotal = items.reduce((sum, i) => (i.insured ? sum + i.price * INSURANCE_RATE : sum), 0);

  /**
   * Crée une session de paiement Stripe et redirige immédiatement vers la
   * page de paiement hébergée par Stripe. La commande n'est créée qu'après
   * confirmation du paiement (webhook côté serveur) — le panier local n'est
   * donc volontairement PAS vidé ici, seulement au retour en cas de succès.
   */
  const startCheckout = async (
    shippingAddress: Record<string, unknown>,
    deliveryType: DeliveryType,
    parcelPoint: ChronopostPickupPoint | null,
    billingAddress?: Record<string, unknown>
  ): Promise<CheckoutResult> => {
    if (items.length === 0) {
      return { success: false, error: 'Le panier est vide' };
    }

    const { data, error } = await invokeEdgeFunction<{ url: string; unavailable_ids?: string[] }>('b2b-checkout', {
      product_ids: items.map((i) => i.id),
      shipping_address: shippingAddress,
      billing_address: billingAddress,
      delivery_type: deliveryType,
      parcel_point: parcelPoint,
      insured_product_ids: items.filter((i) => i.insured).map((i) => i.id),
    });

    if (error) {
      return { success: false, error };
    }

    if (data?.unavailable_ids?.length) {
      const unavailableIds = data.unavailable_ids;
      write(items.filter((i) => !unavailableIds.includes(i.id)));
    }

    if (!data?.url) {
      return { success: false, error: 'Réponse de paiement invalide' };
    }

    window.location.href = data.url;
    return { success: true };
  };

  return {
    items,
    recentlyExpiredNames,
    clearRecentlyExpired: () => setRecentlyExpiredNames([]),
    addItem,
    removeItem,
    clear,
    isInCart,
    toggleInsurance,
    subtotal,
    insuranceTotal,
    startCheckout,
  };
};
