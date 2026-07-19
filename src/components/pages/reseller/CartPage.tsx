import React, { useEffect, useState } from 'react';
import { useB2BCart, CART_ITEM_SESSION_MS, INSURANCE_RATE } from '../../../hooks/useB2BCart';
import { useResellerAuth } from '../../../hooks/useResellerAuth';
import ShippingForm, { ShippingSelection, SHIPPING_RATES } from './ShippingForm';
import CheckoutSummary from './CheckoutSummary';
import { AlertCircle, Trash2, ImageOff, CreditCard, Clock, ArrowLeft, ShoppingBag, X, ShieldCheck } from 'lucide-react';

interface CartPageProps {
  cart: ReturnType<typeof useB2BCart>;
  onBack: () => void;
}

const formatCountdown = (ms: number): string => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

export const CartPage: React.FC<CartPageProps> = ({ cart, onBack }) => {
  const { profile } = useResellerAuth();
  const hasAddress = Boolean(profile?.address && profile?.city && profile?.postal_code);

  const [shipping, setShipping] = useState<ShippingSelection>({
    deliveryType: hasAddress ? 'domicile' : 'point_relais',
    parcelPoint: null,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Force le recalcul du chrono de chaque article à l'affichage (added_at
  // ne change pas, seul "maintenant" avance) — le retrait effectif d'un
  // article expiré est lui géré par useB2BCart, pas ici.
  const [, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const handlePay = async () => {
    if (!profile) return;
    if (shipping.deliveryType === 'domicile' && !hasAddress) return;
    if (shipping.deliveryType === 'point_relais' && !shipping.parcelPoint) {
      setError('Veuillez sélectionner un point relais avant de payer.');
      return;
    }
    setError(null);
    setSubmitting(true);
    const result = await cart.startCheckout(
      {
        line1: profile.address || '',
        line2: '',
        city: profile.city || '',
        postal_code: profile.postal_code || '',
        country: profile.country || 'France',
      },
      shipping.deliveryType,
      shipping.parcelPoint
    );
    // En cas de succès, startCheckout redirige immédiatement vers Stripe —
    // on ne repasse jamais ici. setSubmitting(false) ne sert donc que le cas
    // d'erreur (ex : article devenu indisponible).
    if (!result.success) {
      setSubmitting(false);
      setError(result.error || 'Une erreur est survenue');
    }
  };

  if (cart.items.length === 0) {
    return (
      <div className="p-4 md:p-6">
        <button onClick={onBack} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 mb-6">
          <ArrowLeft className="h-4 w-4" />
          <span>Retour au catalogue</span>
        </button>
        <div className="text-center py-16">
          <ShoppingBag className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Votre panier est vide</h3>
          <p className="text-gray-500 mb-6">Ajoutez des articles depuis le catalogue pour commencer une commande.</p>
          <button
            onClick={onBack}
            className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors text-sm"
          >
            Voir le catalogue
          </button>
        </div>
      </div>
    );
  }

  const shippingCost = SHIPPING_RATES[shipping.deliveryType];
  const total = cart.subtotal + shippingCost + cart.insuranceTotal;

  return (
    <div className="p-4 md:p-6">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 mb-4">
        <ArrowLeft className="h-4 w-4" />
        <span>Retour au catalogue</span>
      </button>

      <div className="mb-6">
        <h3 className="text-lg font-semibold text-gray-900">Mon panier</h3>
        <p className="text-sm text-gray-500">{cart.items.length} article{cart.items.length > 1 ? 's' : ''} réservé{cart.items.length > 1 ? 's' : ''}</p>
      </div>

      {cart.recentlyExpiredNames.length > 0 && (
        <div className="mb-6 rounded-lg border bg-amber-50 border-amber-200 text-amber-800 p-3 flex items-start gap-2">
          <Clock className="h-4 w-4 flex-shrink-0 mt-0.5" />
          <p className="text-sm flex-1">
            {cart.recentlyExpiredNames.length === 1
              ? `"${cart.recentlyExpiredNames[0]}" a expiré et a été retiré de votre panier.`
              : `${cart.recentlyExpiredNames.length} articles ont expiré et ont été retirés de votre panier.`}
          </p>
          <button onClick={cart.clearRecentlyExpired} className="p-0.5 text-amber-600 hover:text-amber-800 flex-shrink-0">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-3 flex items-start space-x-2">
          <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-2 space-y-4">
          <ShippingForm
            companyAddress={{
              address: profile?.address || '',
              city: profile?.city || '',
              postalCode: profile?.postal_code || '',
              country: profile?.country || 'France',
            }}
            value={shipping}
            onChange={setShipping}
          />

          <ul className="space-y-2">
            {cart.items.map((item) => {
              const remainingMs = item.added_at + CART_ITEM_SESSION_MS - Date.now();
              const isUrgent = remainingMs < 2 * 60 * 1000;
              const insuranceCost = item.price * INSURANCE_RATE;
              return (
                <li key={item.id} className="bg-white border border-gray-200 rounded-lg p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center space-x-3 min-w-0">
                      <div className="h-16 w-16 bg-gray-100 rounded flex items-center justify-center flex-shrink-0 overflow-hidden">
                        {item.image ? (
                          <img src={item.image} alt={item.name} className="w-full h-full object-cover" />
                        ) : (
                          <ImageOff className="h-5 w-5 text-gray-300" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{item.name}</p>
                        <p className="text-xs text-gray-400">{item.product_code}</p>
                        <p className="text-sm text-gray-700 mt-1">{item.price.toFixed(0)} €</p>
                        <p className={`text-xs mt-1 flex items-center gap-1 tabular-nums ${isUrgent ? 'text-red-600' : 'text-gray-400'}`}>
                          <Clock className="h-3 w-3 flex-shrink-0" />
                          Réservé encore {formatCountdown(Math.max(0, remainingMs))}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => cart.removeItem(item.id)}
                      disabled={submitting}
                      className="p-2 text-gray-400 hover:text-red-600 transition-colors flex-shrink-0 disabled:opacity-40"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  <label className="mt-3 flex items-center justify-between gap-2 pt-3 border-t border-gray-100 cursor-pointer">
                    <span className="flex items-center gap-2 text-sm text-gray-600">
                      <input
                        type="checkbox"
                        checked={item.insured}
                        onChange={() => cart.toggleInsurance(item.id)}
                        className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-400"
                      />
                      <ShieldCheck className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                      Assurer cet article (+0.6%)
                    </span>
                    <span className={`text-sm font-medium ${item.insured ? 'text-gray-900' : 'text-gray-400'}`}>
                      +{insuranceCost.toFixed(2)} €
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="lg:sticky lg:top-6 space-y-4">
          <CheckoutSummary
            subtotal={cart.subtotal}
            shipping={shippingCost}
            insurance={cart.insuranceTotal}
            total={total}
            deliveryType={shipping.deliveryType}
          />

          <button
            onClick={handlePay}
            disabled={submitting}
            className="w-full flex items-center justify-center space-x-2 px-4 py-2.5 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
          >
            {submitting ? (
              <span>Traitement du paiement...</span>
            ) : (
              <>
                <CreditCard className="h-4 w-4" />
                <span>Payer la commande ({total.toFixed(2)} €)</span>
              </>
            )}
          </button>
          <p className="text-xs text-gray-400 text-center">Paiement sécurisé par Stripe.</p>
        </div>
      </div>
    </div>
  );
};
