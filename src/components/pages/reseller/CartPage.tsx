import React, { useEffect, useState } from 'react';
import { useB2BCart } from '../../../hooks/useB2BCart';
import { useResellerAuth } from '../../../hooks/useResellerAuth';
import { AlertCircle, Trash2, ImageOff, CreditCard, MapPin, Clock, ArrowLeft, ShoppingBag } from 'lucide-react';

interface CartPageProps {
  cart: ReturnType<typeof useB2BCart>;
  onBack: () => void;
  onExpired: () => void;
}

const formatCountdown = (ms: number): string => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

export const CartPage: React.FC<CartPageProps> = ({ cart, onBack, onExpired }) => {
  const { profile } = useResellerAuth();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remainingMs, setRemainingMs] = useState<number | null>(
    cart.expiresAt ? cart.expiresAt - Date.now() : null
  );

  const hasAddress = Boolean(profile?.address && profile?.city && profile?.postal_code);

  // Le panier a expiré pendant que la page était fermée/rechargée : le hook
  // l'a déjà vidé au chargement, on ne fait ici que déclencher la
  // redirection + le message d'expiration côté catalogue.
  useEffect(() => {
    if (cart.expiredOnLoad) {
      onExpired();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart.expiredOnLoad]);

  // Compte à rebours de la session de réservation du panier : suspendu
  // pendant le traitement du paiement pour ne pas vider le panier sous les
  // pieds du revendeur au moment où il attend la redirection Stripe.
  useEffect(() => {
    if (!cart.expiresAt || submitting) return;

    const tick = () => {
      const remaining = (cart.expiresAt as number) - Date.now();
      setRemainingMs(remaining);
      if (remaining <= 0) {
        cart.clear();
        onExpired();
      }
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart.expiresAt, submitting]);

  const handlePay = async () => {
    if (!hasAddress || !profile) return;
    setError(null);
    setSubmitting(true);
    const result = await cart.startCheckout({
      line1: profile.address || '',
      line2: '',
      city: profile.city || '',
      postal_code: profile.postal_code || '',
      country: profile.country || 'France',
    });
    // En cas de succès, startCheckout redirige immédiatement vers Stripe —
    // on ne repasse jamais ici. setSubmitting(false) ne sert donc que le cas
    // d'erreur (ex : article devenu indisponible).
    if (!result.success) {
      setSubmitting(false);
      setError(result.error || 'Une erreur est survenue');
    }
  };

  const isUrgent = remainingMs !== null && remainingMs < 2 * 60 * 1000;

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

      {remainingMs !== null && (
        <div
          className={`mb-6 rounded-lg border p-3 flex items-center gap-2 ${
            isUrgent ? 'bg-red-50 border-red-200 text-red-800' : 'bg-amber-50 border-amber-200 text-amber-800'
          }`}
        >
          <Clock className="h-4 w-4 flex-shrink-0" />
          <p className="text-sm">
            Temps restant pour finaliser votre commande :{' '}
            <span className="font-semibold tabular-nums">{formatCountdown(Math.max(0, remainingMs))}</span>
          </p>
        </div>
      )}

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-3 flex items-start space-x-2">
          <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-2">
          <ul className="space-y-2">
            {cart.items.map((item) => (
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
            ))}
          </ul>
        </div>

        <div className="lg:sticky lg:top-6 bg-white border border-gray-200 rounded-lg p-4 space-y-4">
          <h4 className="text-sm font-semibold text-gray-900">Récapitulatif</h4>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500">Sous-total</span>
              <span className="text-gray-900">{cart.subtotal.toFixed(0)} €</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500">Taxes</span>
              <span className="text-gray-400">Incluses</span>
            </div>
            <div className="flex items-center justify-between border-t border-gray-100 pt-2">
              <span className="text-sm font-medium text-gray-700">Total</span>
              <span className="text-lg font-semibold text-gray-900">{cart.subtotal.toFixed(0)} €</span>
            </div>
          </div>

          <div className="border-t border-gray-100 pt-4">
            <p className="text-sm font-medium text-gray-700 mb-2">Adresse de livraison</p>
            {hasAddress && profile ? (
              <div className="bg-gray-50 rounded-lg p-3 flex items-start gap-2">
                <MapPin className="h-4 w-4 text-gray-400 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-gray-900">
                  Livré à : {profile.company_name}, {profile.address}, {profile.postal_code} {profile.city}, {profile.country}
                </p>
              </div>
            ) : (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-amber-800">
                  Aucune adresse de livraison configurée. Veuillez contacter votre administrateur.
                </p>
              </div>
            )}
          </div>

          <button
            onClick={handlePay}
            disabled={submitting || !hasAddress}
            className="w-full flex items-center justify-center space-x-2 px-4 py-2.5 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
          >
            {submitting ? (
              <span>Traitement du paiement...</span>
            ) : (
              <>
                <CreditCard className="h-4 w-4" />
                <span>Payer la commande ({cart.subtotal.toFixed(0)} €)</span>
              </>
            )}
          </button>
          <p className="text-xs text-gray-400 text-center">Paiement sécurisé par Stripe.</p>
        </div>
      </div>
    </div>
  );
};
