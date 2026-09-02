import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { B2BCatalogItem } from './useB2BCatalog';
import { invokeEdgeFunction } from '../utils/invokeEdgeFunction';
import { getVolumeDiscountRate } from '../utils/volumeDiscount';

export interface B2BCartItem {
  /** = product_id : conservé comme identifiant principal pour ne pas casser
   * isInCart/removeItem/toggleInsurance, qui raisonnent toujours par produit. */
  id: string;
  cartItemId: string;
  name: string;
  product_code: string;
  image: string | null;
  price: number;
  brandName: string | null;
  categoryName: string | null;
  addedAt: string;
  /** Assurance Sendcloud optionnelle, 0.6% de la valeur de l'article — pure
   * préférence d'affichage/checkout, non persistée côté serveur. */
  insured: boolean;
}

/** Taux d'assurance Sendcloud (0.6% de la valeur de l'article). Recalculé
 * côté serveur dans b2b-checkout — jamais accepté tel quel du client. */
export const INSURANCE_RATE = 0.006;

/** Timer global de réservation du panier (voir cart_add_item côté serveur :
 * réinitialisé à 10 min pour TOUT le panier à chaque ajout réussi). */
export const RESERVATION_SESSION_MS = 10 * 60 * 1000;

export interface CartDropInfo {
  active: boolean;
  freeSlotsRemaining: number;
  /** Horodatage local (Date.now()-comparable) du prochain ajout autorisé, ou
   * null si aucun cooldown de quota n'est actuellement en cours. */
  nextAddAvailableAt: number | null;
}

export interface CartBlockingError {
  code: string;
  message: string;
  /** Horodatage local (Date.now()-comparable) de fin d'attente, ou null si le
   * blocage n'est pas temporisé (ex. article indisponible). */
  retryAt: number | null;
}

interface CheckoutResult {
  success: boolean;
  error?: string;
  unavailableIds?: string[];
  /** Renseigné uniquement pour un paiement 100% solde : pas de redirection
   * Stripe, la commande existe déjà — voir onWalletPaymentSuccess côté CartPage. */
  orderId?: string;
}

interface AddItemResult {
  success: boolean;
  error?: string;
  errorCode?: string;
  /** Repris tel quel de cart_add_item pour les blocages temporisés
   * (DROP_QUOTA_COOLDOWN, ITEM_RECENTLY_REMOVED). */
  retryAfterSeconds?: number;
}

const INSURANCE_PREFS_PREFIX = 'b2b_cart_insurance_';

const loadInsurancePrefs = (profileId: string | null): Record<string, boolean> => {
  if (!profileId) return {};
  try {
    const raw = localStorage.getItem(INSURANCE_PREFS_PREFIX + profileId);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

const saveInsurancePrefs = (profileId: string | null, prefs: Record<string, boolean>) => {
  if (!profileId) return;
  try {
    localStorage.setItem(INSURANCE_PREFS_PREFIX + profileId, JSON.stringify(prefs));
  } catch {
    // Best-effort : une préférence d'assurance non persistée redémarre juste à "assuré" par défaut.
  }
};

/** Convertit un timestamp serveur absolu en horodatage comparable à
 * Date.now() côté client, en corrigeant le décalage d'horloge via server_now
 * (renvoyé par la même réponse RPC) plutôt qu'en faisant confiance à
 * l'horloge locale. */
const toLocalDeadline = (isoTimestamp: string | null | undefined, serverNowIso: string | null | undefined): number | null => {
  if (!isoTimestamp || !serverNowIso) return null;
  const serverNowMs = new Date(serverNowIso).getTime();
  const targetMs = new Date(isoTimestamp).getTime();
  if (Number.isNaN(serverNowMs) || Number.isNaN(targetMs)) return null;
  return Date.now() + (targetMs - serverNowMs);
};

interface RawCartItem {
  cart_item_id: string;
  product_id: string;
  product_name: string;
  product_code: string;
  sale_price: number;
  brand_name: string | null;
  category_name: string | null;
  main_image_url: string | null;
  added_at: string;
  expires_at: string | null;
}

export const useB2BCart = (profileId: string | undefined) => {
  const [items, setItems] = useState<B2BCartItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [globalExpiresAt, setGlobalExpiresAt] = useState<number | null>(null);
  const [dropInfo, setDropInfo] = useState<CartDropInfo>({ active: false, freeSlotsRemaining: 3, nextAddAvailableAt: null });
  const [blockingError, setBlockingError] = useState<CartBlockingError | null>(null);
  const [cartExpired, setCartExpired] = useState(false);

  const itemsRef = useRef<B2BCartItem[]>([]);
  itemsRef.current = items;
  const insurancePrefsRef = useRef<Record<string, boolean>>({});
  const profileIdRef = useRef<string | undefined>(profileId);
  profileIdRef.current = profileId;

  useEffect(() => {
    insurancePrefsRef.current = loadInsurancePrefs(profileId ?? null);
  }, [profileId]);

  const mapItem = useCallback((raw: RawCartItem): B2BCartItem => ({
    id: raw.product_id,
    cartItemId: raw.cart_item_id,
    name: raw.product_name,
    product_code: raw.product_code,
    image: raw.main_image_url,
    price: raw.sale_price,
    brandName: raw.brand_name,
    categoryName: raw.category_name,
    addedAt: raw.added_at,
    insured: insurancePrefsRef.current[raw.product_id] !== false,
  }), []);

  const refresh = useCallback(async () => {
    if (!profileId) {
      setItems([]);
      setGlobalExpiresAt(null);
      setLoading(false);
      return;
    }

    const { data, error } = await supabase.rpc('get_cart_state');
    if (error) {
      console.error('Erreur lors du chargement du panier B2B:', error);
      setLoading(false);
      return;
    }

    const wasNonEmpty = itemsRef.current.length > 0;
    const rawItems: RawCartItem[] = data?.items || [];
    const nextItems = rawItems.map(mapItem);

    setItems(nextItems);
    setGlobalExpiresAt(toLocalDeadline(data?.global_expires_at, data?.server_now));
    setDropInfo({
      active: Boolean(data?.drop?.active),
      freeSlotsRemaining: data?.drop?.free_slots_remaining ?? 3,
      nextAddAvailableAt: toLocalDeadline(data?.drop?.next_add_available_at, data?.server_now),
    });

    if (wasNonEmpty && nextItems.length === 0) {
      setCartExpired(true);
    }
    setLoading(false);
  }, [profileId, mapItem]);

  // Recharge au montage / changement de revendeur.
  useEffect(() => {
    setBlockingError(null);
    setCartExpired(false);
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId]);

  // Poll périodique : le sweep serveur (pg_cron, toutes les minutes) peut
  // libérer des articles expirés sans action locale — garde le panier
  // synchronisé avec la réalité serveur plutôt que de ne se fier qu'au
  // décompte local du timer global.
  useEffect(() => {
    if (!profileId) return;
    const interval = setInterval(refresh, 15000);
    return () => clearInterval(interval);
  }, [profileId, refresh]);

  // Tick chaque seconde : force le recalcul de l'affichage des chronos, et
  // rafraîchit dès que le timer global atteint zéro ou qu'un blocage
  // temporisé expire.
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => {
      setTick((t) => t + 1);

      if (globalExpiresAt !== null && globalExpiresAt <= Date.now()) {
        refresh();
      }

      setBlockingError((current) => {
        if (current && current.retryAt !== null && current.retryAt <= Date.now()) {
          return null;
        }
        return current;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [globalExpiresAt, refresh]);

  const addItem = async (product: B2BCatalogItem): Promise<AddItemResult> => {
    if (itemsRef.current.some((i) => i.id === product.id)) return { success: true };

    const { data, error } = await supabase.rpc('cart_add_item', { p_product_id: product.id });
    if (error) {
      return { success: false, error: error.message };
    }

    if (!data?.success) {
      const errorCode: string | undefined = data?.error_code;
      const message: string = data?.message || "Impossible d'ajouter cet article";
      const retryAfterSeconds: number | undefined = data?.retry_after_seconds;

      if (retryAfterSeconds) {
        setBlockingError({
          code: errorCode || 'BLOCKED',
          message,
          retryAt: Date.now() + retryAfterSeconds * 1000,
        });
      }

      return { success: false, error: message, errorCode, retryAfterSeconds };
    }

    await refresh();
    return { success: true };
  };

  const removeItem = async (id: string) => {
    const { data, error } = await supabase.rpc('cart_remove_item', { p_product_id: id });
    if (error) {
      console.error("Erreur lors du retrait de l'article:", error);
      return;
    }
    if (!data?.success) {
      console.error('Retrait refusé:', data?.message);
    }
    await refresh();
  };

  const clear = async () => {
    const { error } = await supabase.rpc('cart_clear');
    if (error) console.error('Erreur lors du vidage du panier:', error);
    await refresh();
  };

  const isInCart = (id: string) => items.some((i) => i.id === id);

  const toggleInsurance = (id: string) => {
    const currentlyInsured = insurancePrefsRef.current[id] !== false;
    const nextPrefs = { ...insurancePrefsRef.current, [id]: !currentlyInsured };
    insurancePrefsRef.current = nextPrefs;
    saveInsurancePrefs(profileIdRef.current ?? null, nextPrefs);
    setItems((current) => current.map((i) => (i.id === id ? { ...i, insured: !i.insured } : i)));
  };

  const dismissBlockingError = () => setBlockingError(null);
  const clearCartExpired = () => setCartExpired(false);

  const subtotal = items.reduce((sum, i) => sum + i.price, 0);
  const insuranceTotal = items.reduce((sum, i) => (i.insured ? sum + i.price * INSURANCE_RATE : sum), 0);
  // Remise dégressive sur volume : porte uniquement sur la valeur des
  // articles, jamais sur la livraison ni l'assurance. Affichage uniquement —
  // recalculée côté serveur dans b2b-checkout à partir du panier réellement
  // disponible, jamais acceptée telle quelle d'ici.
  const discountRate = getVolumeDiscountRate(items.length);
  const discountAmount = Math.round(subtotal * discountRate * 100) / 100;

  /**
   * Crée une session de paiement Stripe et redirige immédiatement vers la
   * page de paiement hébergée par Stripe. La commande n'est créée qu'après
   * confirmation du paiement (webhook côté serveur) — le panier serveur n'est
   * donc volontairement PAS vidé ici, seulement au retour en cas de succès.
   */
  const startCheckout = async (
    promoCode?: string | null,
    paymentMethod: 'card' | 'wallet' | 'mixed' = 'card'
  ): Promise<CheckoutResult> => {
    if (items.length === 0) {
      return { success: false, error: 'Le panier est vide' };
    }

    const { data, error } = await invokeEdgeFunction<{ url?: string; order_id?: string; unavailable_ids?: string[] }>('b2b-checkout', {
      product_ids: items.map((i) => i.id),
      insured_product_ids: items.filter((i) => i.insured).map((i) => i.id),
      promo_code: promoCode || null,
      payment_method: paymentMethod,
    });

    if (error) {
      return { success: false, error };
    }

    if (data?.unavailable_ids?.length) {
      await refresh();
    }

    // Paiement 100% solde : pas de redirection, la commande est déjà créée.
    if (data?.order_id) {
      return { success: true, orderId: data.order_id };
    }

    if (!data?.url) {
      return { success: false, error: 'Réponse de paiement invalide' };
    }

    window.location.href = data.url;
    return { success: true };
  };

  return {
    items,
    loading,
    globalExpiresAt,
    dropInfo,
    blockingError,
    dismissBlockingError,
    cartExpired,
    clearCartExpired,
    addItem,
    removeItem,
    clear,
    isInCart,
    toggleInsurance,
    subtotal,
    insuranceTotal,
    discountRate,
    discountAmount,
    startCheckout,
    refresh,
  };
};
