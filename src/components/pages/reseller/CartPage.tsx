import React, { useEffect, useState } from 'react';
import { useB2BCart, INSURANCE_RATE } from '../../../hooks/useB2BCart';
import { useWallet } from '../../../hooks/useWallet';
import { useResellerAuth } from '../../../hooks/useResellerAuth';
import CheckoutSummary from './CheckoutSummary';
import { VolumeDiscountBanner } from './VolumeDiscountBanner';
import { PromoCodeField, AppliedPromo } from './PromoCodeField';
import { AlertCircle, Trash2, ImageOff, CreditCard, Clock, ArrowLeft, ShoppingBag, X, ShieldCheck, Wallet } from 'lucide-react';

interface CartPageProps {
  cart: ReturnType<typeof useB2BCart>;
  wallet: ReturnType<typeof useWallet>;
  onBack: () => void;
  /** Paiement 100% solde : pas de redirection Stripe, la commande existe déjà. */
  onWalletPaymentSuccess: (orderId: string) => void;
}

const formatCountdown = (ms: number): string => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

export const CartPage: React.FC<CartPageProps> = ({ cart, wallet, onBack, onWalletPaymentSuccess }) => {
  const { profile } = useResellerAuth();

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appliedPromo, setAppliedPromo] = useState<AppliedPromo | null>(null);
  const [useWalletPayment, setUseWalletPayment] = useState(false);
  // Force le recalcul du chrono de chaque article à l'affichage (added_at
  // ne change pas, seul "maintenant" avance) — le retrait effectif d'un
  // article expiré est lui géré par useB2BCart, pas ici.
  const [, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  // Le montant de la remise appliquée est figé au moment du clic sur
  // "Appliquer" (contre le sous-total d'alors) : si le panier change ensuite
  // (article retiré/ajouté), on retire le code pour forcer une revalidation
  // contre le nouveau sous-total plutôt que de garder un montant obsolète.
  useEffect(() => {
    setAppliedPromo(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart.items.length]);

  const handlePay = async () => {
    if (!profile) return;
    setError(null);
    setSubmitting(true);
    const paymentMethod = useWalletPayment ? (wallet.balance >= total ? 'wallet' : 'mixed') : 'card';
    const result = await cart.startCheckout(appliedPromo?.code || null, paymentMethod);
    // En cas de succès par carte/mixte, startCheckout redirige immédiatement
    // vers Stripe — on ne repasse jamais ici. Un paiement 100% solde renvoie
    // directement l'orderId (pas de Stripe du tout, voir onWalletPaymentSuccess).
    if (result.success && result.orderId) {
      onWalletPaymentSuccess(result.orderId);
      return;
    }
    if (!result.success) {
      setSubmitting(false);
      setError(result.error || 'Une erreur est survenue');
    }
  };

  const globalRemainingMs = cart.globalExpiresAt !== null ? cart.globalExpiresAt - Date.now() : null;
  const globalUrgent = globalRemainingMs !== null && globalRemainingMs < 2 * 60 * 1000;

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

  const promoDiscountAmount = appliedPromo?.discountAmount || 0;
  const total = cart.subtotal - cart.discountAmount - promoDiscountAmount + cart.insuranceTotal;

  return (
    <div className="p-4 md:p-6">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 mb-4">
        <ArrowLeft className="h-4 w-4" />
        <span>Retour au catalogue</span>
      </button>

      <div className="mb-6 flex items-start justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Mon panier</h3>
          <p className="text-sm text-gray-500">{cart.items.length} article{cart.items.length > 1 ? 's' : ''} réservé{cart.items.length > 1 ? 's' : ''}</p>
        </div>
        {globalRemainingMs !== null && (
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium tabular-nums ${
            globalUrgent ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-gray-50 text-gray-700 border border-gray-200'
          }`}>
            <Clock className="h-4 w-4 flex-shrink-0" />
            Panier réservé encore {formatCountdown(globalRemainingMs)}
          </div>
        )}
      </div>

      {cart.cartExpired && (
        <div className="mb-6 rounded-lg border bg-amber-50 border-amber-200 text-amber-800 p-3 flex items-start gap-2">
          <Clock className="h-4 w-4 flex-shrink-0 mt-0.5" />
          <p className="text-sm flex-1">
            Votre réservation a expiré : les articles de votre panier ont été libérés.
          </p>
          <button onClick={cart.clearCartExpired} className="p-0.5 text-amber-600 hover:text-amber-800 flex-shrink-0">
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
          <VolumeDiscountBanner itemCount={cart.items.length} />

          <ul className="space-y-2">
            {cart.items.map((item) => {
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
          <PromoCodeField
            subtotal={cart.subtotal}
            applied={appliedPromo}
            onApply={setAppliedPromo}
            onRemove={() => setAppliedPromo(null)}
          />

          <CheckoutSummary
            subtotal={cart.subtotal}
            insurance={cart.insuranceTotal}
            total={total}
            discountRate={cart.discountRate}
            discountAmount={cart.discountAmount}
            promoCode={appliedPromo?.code}
            promoDiscountAmount={promoDiscountAmount}
          />

          {wallet.balance > 0 && (
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={useWalletPayment}
                  onChange={(e) => setUseWalletPayment(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-400 flex-shrink-0"
                />
                <span className="flex-1">
                  <span className="flex items-center gap-1.5 text-sm font-medium text-gray-900">
                    <Wallet className="h-4 w-4 text-gray-500" />
                    Payer avec mon solde B2B
                  </span>
                  <span className="block text-xs text-gray-500 mt-0.5">
                    Solde disponible : {wallet.balance.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
                  </span>
                </span>
              </label>

              {useWalletPayment && (
                <div className="mt-3 pt-3 border-t border-gray-100 text-xs text-gray-600 space-y-1">
                  {wallet.balance >= total ? (
                    <p>Le solde couvre l'intégralité de la commande — aucun paiement par carte requis.</p>
                  ) : (
                    <>
                      <div className="flex justify-between">
                        <span>Déduit du solde</span>
                        <span className="font-medium text-gray-900">-{wallet.balance.toFixed(2)} €</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Reste à payer par carte</span>
                        <span className="font-medium text-gray-900">{(total - wallet.balance).toFixed(2)} €</span>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          <button
            onClick={handlePay}
            disabled={submitting}
            className="w-full flex items-center justify-center space-x-2 px-4 py-2.5 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
          >
            {submitting ? (
              <span>Traitement du paiement...</span>
            ) : useWalletPayment && wallet.balance >= total ? (
              <>
                <Wallet className="h-4 w-4" />
                <span>Payer avec mon solde ({total.toFixed(2)} €)</span>
              </>
            ) : useWalletPayment ? (
              <>
                <CreditCard className="h-4 w-4" />
                <span>Payer {(total - wallet.balance).toFixed(2)} € par carte (+ solde)</span>
              </>
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
