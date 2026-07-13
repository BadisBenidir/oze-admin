import React, { useState } from 'react';
import { Modal } from '../../ui/Modal';
import { useB2BCart } from '../../../hooks/useB2BCart';
import { AlertCircle, Trash2, ImageOff, CreditCard } from 'lucide-react';

interface CartPanelProps {
  isOpen: boolean;
  onClose: () => void;
  cart: ReturnType<typeof useB2BCart>;
}

const emptyAddress = { line1: '', line2: '', city: '', postal_code: '', country: 'France' };

export const CartPanel: React.FC<CartPanelProps> = ({ isOpen, onClose, cart }) => {
  const [address, setAddress] = useState(emptyAddress);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAddressValid = Boolean(address.line1.trim() && address.city.trim() && address.postal_code.trim());

  const handleClose = () => {
    if (submitting) return;
    setError(null);
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!isAddressValid) {
      setError('Merci de renseigner une adresse de livraison complète (adresse, code postal, ville)');
      return;
    }

    setSubmitting(true);
    const result = await cart.startCheckout(address);
    // En cas de succès, startCheckout redirige immédiatement vers Stripe —
    // on ne repasse jamais ici. setSubmitting(false) ne sert donc que le cas
    // d'erreur (ex : article devenu indisponible entre-temps).
    if (!result.success) {
      setSubmitting(false);
      setError(result.error || 'Une erreur est survenue');
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Mon panier">
      <div className="space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start space-x-2">
            <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {cart.items.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-6">Votre panier est vide.</p>
        ) : (
          <ul className="space-y-2 max-h-64 overflow-y-auto">
            {cart.items.map((item) => (
              <li key={item.id} className="flex items-center justify-between bg-gray-50 rounded-lg p-2">
                <div className="flex items-center space-x-3 min-w-0">
                  <div className="h-10 w-10 bg-gray-100 rounded flex items-center justify-center flex-shrink-0 overflow-hidden">
                    {item.image ? (
                      <img src={item.image} alt={item.name} className="w-full h-full object-cover" />
                    ) : (
                      <ImageOff className="h-4 w-4 text-gray-300" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{item.name}</p>
                    <p className="text-xs text-gray-500">{item.price.toFixed(0)} €</p>
                  </div>
                </div>
                <button
                  onClick={() => cart.removeItem(item.id)}
                  disabled={submitting}
                  className="p-1 text-gray-400 hover:text-red-600 transition-colors flex-shrink-0 disabled:opacity-40"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {cart.items.length > 0 && (
          <>
            <div className="flex items-center justify-between border-t border-gray-100 pt-3">
              <span className="text-sm font-medium text-gray-700">Sous-total</span>
              <span className="text-lg font-semibold text-gray-900">{cart.subtotal.toFixed(0)} €</span>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3 border-t border-gray-100 pt-3">
              <p className="text-sm font-medium text-gray-700">Adresse de livraison</p>
              <input
                type="text"
                placeholder="Adresse *"
                value={address.line1}
                onChange={(e) => setAddress({ ...address, line1: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                disabled={submitting}
                required
              />
              <input
                type="text"
                placeholder="Complément d'adresse"
                value={address.line2}
                onChange={(e) => setAddress({ ...address, line2: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                disabled={submitting}
              />
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="text"
                  placeholder="Code postal *"
                  value={address.postal_code}
                  onChange={(e) => setAddress({ ...address, postal_code: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                  disabled={submitting}
                  required
                />
                <input
                  type="text"
                  placeholder="Ville *"
                  value={address.city}
                  onChange={(e) => setAddress({ ...address, city: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                  disabled={submitting}
                  required
                />
              </div>
              <input
                type="text"
                placeholder="Pays"
                value={address.country}
                onChange={(e) => setAddress({ ...address, country: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                disabled={submitting}
              />

              <button
                type="submit"
                disabled={submitting || !isAddressValid}
                className="w-full flex items-center justify-center space-x-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
              >
                {submitting ? (
                  <span>Traitement en cours...</span>
                ) : (
                  <>
                    <CreditCard className="h-4 w-4" />
                    <span>Procéder au paiement</span>
                  </>
                )}
              </button>
              <p className="text-xs text-gray-400 text-center">Paiement sécurisé par Stripe.</p>
            </form>
          </>
        )}
      </div>
    </Modal>
  );
};
