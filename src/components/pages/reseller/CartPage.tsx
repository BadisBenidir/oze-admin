import React, { useEffect, useState } from 'react';
import { useB2BCart, CART_ITEM_SESSION_MS } from '../../../hooks/useB2BCart';
import { useResellerAuth } from '../../../hooks/useResellerAuth';
import ShippingForm, { ShippingSelection, SHIPPING_RATES } from './ShippingForm';
import CheckoutSummary from './CheckoutSummary';
import { AlertCircle, Trash2, ImageOff, CreditCard, Clock, ArrowLeft, ShoppingBag, X, CheckCircle } from 'lucide-react';

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

type Step = 'shipping' | 'review';

export const CartPage: React.FC<CartPageProps> = ({ cart, onBack }) => {
  const { profile } = useResellerAuth();
  const [step, setStep] = useState<Step>('shipping');
  const [shipping, setShipping] = useState<ShippingSelection | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Force le recalcul du chrono de chaque article à l'affichage (added_at
  // ne change pas, seul "maintenant" avance) — le retrait effectif d'un
  // article expiré est lui géré par useB2BCart, pas ici.
  const [, setTick] = useState(0);

  const hasAddress = Boolean(profile?.address && profile?.city && profile?.postal_code);

  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const handleShippingSubmit = (selection: ShippingSelection) => {
    setShipping(selection);
    setStep('review');
  };

  const handlePay = async () => {
    if (!profile || !shipping) return;
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

  const shippingCost = shipping ? SHIPPING_RATES[shipping.deliveryType] : 0;
  const total = cart.subtotal + shippingCost;

  return (
    <div className="p-4 md:p-6">
      <button
        onClick={() => (step === 'review' ? setStep('shipping') : onBack())}
        className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 mb-4"
      >
        <ArrowLeft className="h-4 w-4" />
        <span>{step === 'review' ? 'Modifier la livraison' : 'Retour au catalogue'}</span>
      </button>

      <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Mon panier</h3>
          <p className="text-sm text-gray-500">{cart.items.length} article{cart.items.length > 1 ? 's' : ''} réservé{cart.items.length > 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <StepDot active={step === 'shipping'} done={step === 'review'} label="1" />
          <div className={`h-0.5 w-8 ${step === 'review' ? 'bg-gray-900' : 'bg-gray-200'}`} />
          <StepDot active={step === 'review'} done={false} label="2" />
        </div>
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

      {!hasAddress && step === 'shipping' && (
        <div className="mb-6 bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800">
            Aucune adresse enregistrée pour votre entreprise : seul le Point Relais est disponible. Contactez votre administrateur pour l'ajouter.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-2 space-y-4">
          {step === 'shipping' ? (
            <ShippingForm
              companyAddress={{
                address: profile?.address || '',
                city: profile?.city || '',
                postalCode: profile?.postal_code || '',
                country: profile?.country || 'France',
              }}
              onSubmit={handleShippingSubmit}
            />
          ) : (
            <>
              {shipping && (
                <div className="bg-white border border-gray-200 rounded-lg p-3 flex items-center gap-2 text-sm text-gray-700">
                  <CheckCircle className="h-4 w-4 text-green-600 flex-shrink-0" />
                  <span>
                    Livraison choisie :{' '}
                    <span className="font-medium">
                      {shipping.deliveryType === 'point_relais' ? `Point Relais — ${shipping.parcelPoint?.name}` : "À l'entreprise"}
                    </span>
                  </span>
                </div>
              )}
              <ul className="space-y-2">
                {cart.items.map((item) => {
                  const remainingMs = item.added_at + CART_ITEM_SESSION_MS - Date.now();
                  const isUrgent = remainingMs < 2 * 60 * 1000;
                  return (
                    <li key={item.id} className="flex items-center justify-between bg-white border border-gray-200 rounded-lg p-3">
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
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>

        {step === 'review' && shipping && (
          <div className="lg:sticky lg:top-6 space-y-4">
            <CheckoutSummary
              items={cart.items}
              subtotal={cart.subtotal}
              shipping={shippingCost}
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
        )}
      </div>
    </div>
  );
};

const StepDot: React.FC<{ active: boolean; done: boolean; label: string }> = ({ active, done, label }) => (
  <div
    className={`h-6 w-6 rounded-full flex items-center justify-center text-xs font-medium ${
      done ? 'bg-green-500 text-white' : active ? 'bg-gray-900 text-white' : 'bg-gray-200 text-gray-500'
    }`}
  >
    {done ? <CheckCircle className="h-3 w-3" /> : label}
  </div>
);
