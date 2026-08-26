import React, { useMemo, useState } from 'react';
import { X, Truck, AlertCircle, CreditCard } from 'lucide-react';
import ShippingForm, { ShippingSelection } from './ShippingForm';
import { useResellerAuth } from '../../../hooks/useResellerAuth';
import { computeShippingCost } from '../../../utils/b2bShippingPricing';
import { isPlausiblePhone } from '../../../utils/phoneValidation';
import { supabase } from '../../../lib/supabase';

interface RequestDeliveryModalProps {
  items: { shipping_points: number }[];
  onClose: () => void;
  onSubmit: (deliveryType: ShippingSelection['deliveryType'], parcelPoint: ShippingSelection['parcelPoint'], instructions: string | null) => Promise<{ success: boolean; url?: string; error?: string }>;
}

/**
 * Le mode/l'adresse de livraison ne sont plus choisis au checkout (voir
 * CartPage) : c'est ici, une seule fois par demande de livraison plutôt
 * qu'une fois par commande, que le revendeur les choisit — au moment où il
 * demande effectivement la livraison des articles ready_to_ship qu'il a
 * sélectionnés. Les frais de port sont désormais payants (carte uniquement,
 * barème par points) : la confirmation redirige vers Stripe plutôt que de
 * créer immédiatement la demande — voir finalize_b2b_delivery_request,
 * appelée seulement après paiement confirmé par b2b-stripe-webhook.
 */
export const RequestDeliveryModal: React.FC<RequestDeliveryModalProps> = ({ items, onClose, onSubmit }) => {
  const { profile } = useResellerAuth();
  const hasAddress = Boolean(profile?.address && profile?.city && profile?.postal_code);

  const [shipping, setShipping] = useState<ShippingSelection>({
    deliveryType: hasAddress ? 'domicile' : 'point_relais',
    parcelPoint: null,
  });
  const [instructions, setInstructions] = useState(profile?.delivery_instructions || '');
  const [phone, setPhone] = useState(profile?.phone || '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsPhone = !isPlausiblePhone(profile?.phone);

  const pricePreview = useMemo(
    () => computeShippingCost(items.map((i) => ({ points: i.shipping_points })), shipping.deliveryType),
    [items, shipping.deliveryType]
  );

  // Prix réel par mode, pour les badges de ShippingForm — remplace un ancien
  // tarif statique qui affichait 0,00 € pour le point relais (voir
  // ShippingForm.tsx).
  const priceByMode = useMemo(() => {
    const points = items.map((i) => ({ points: i.shipping_points }));
    return {
      domicile: computeShippingCost(points, 'domicile').cost,
      point_relais: computeShippingCost(points, 'point_relais').cost,
    };
  }, [items]);

  const handleSubmit = async () => {
    if (shipping.deliveryType === 'domicile' && !hasAddress) return;
    if (shipping.deliveryType === 'point_relais' && !shipping.parcelPoint) {
      setError('Veuillez sélectionner un point relais avant de confirmer.');
      return;
    }
    if (needsPhone && !isPlausiblePhone(phone)) {
      setError('Un numéro de téléphone valide est requis par le transporteur pour livrer votre commande.');
      return;
    }
    setError(null);
    setSubmitting(true);

    // Le téléphone est requis par Sendcloud (Mondial Relay en particulier) au
    // moment de générer le bordereau, bien après cette demande — enregistré
    // ici une bonne fois sur le profil dès qu'il manquait, pour ne plus
    // jamais avoir à le redemander.
    if (needsPhone && profile) {
      const { error: phoneError } = await supabase.from('profiles').update({ phone: phone.trim() }).eq('id', profile.id);
      if (phoneError) {
        setSubmitting(false);
        setError("Impossible d'enregistrer le numéro de téléphone : " + phoneError.message);
        return;
      }
    }

    const result = await onSubmit(shipping.deliveryType, shipping.parcelPoint, instructions || null);
    if (!result.success) {
      setSubmitting(false);
      setError(result.error || 'Une erreur est survenue');
      return;
    }
    // Redirection immédiate vers Stripe — la demande n'est créée qu'après
    // paiement confirmé (webhook), on ne repasse jamais ici.
    window.location.href = result.url!;
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="fixed inset-0 bg-black bg-opacity-25" onClick={onClose} />

        <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-start justify-between p-6 border-b border-gray-100">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Demander la livraison</h3>
              <p className="text-sm text-gray-500 mt-1">
                {items.length} article{items.length > 1 ? 's' : ''} sélectionné{items.length > 1 ? 's' : ''} — {pricePreview.parcelCount} colis
              </p>
            </div>
            <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg transition-colors">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="p-6 space-y-4">
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            <ShippingForm
              companyAddress={{
                address: profile?.address || '',
                city: profile?.city || '',
                postalCode: profile?.postal_code || '',
                country: profile?.country || 'France',
              }}
              value={shipping}
              onChange={setShipping}
              priceByMode={priceByMode}
            />

            {shipping.deliveryType === 'domicile' && (
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Consignes de livraison (optionnel)</label>
                <textarea
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-400"
                  placeholder="Étage, digicode, horaires..."
                />
              </div>
            )}

            {needsPhone && (
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Numéro de téléphone (requis par le transporteur)</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:border-gray-400 ${
                    phone.length > 0 && !isPlausiblePhone(phone) ? 'border-red-300' : 'border-gray-200'
                  }`}
                  placeholder="06 12 34 56 78"
                />
                <p className="text-xs text-gray-500 mt-1">Aucun numéro n'est enregistré sur votre profil — requis pour livrer votre colis.</p>
              </div>
            )}

            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 flex items-center justify-between">
              <span className="text-sm text-gray-700">Frais de port ({pricePreview.parcelCount} colis)</span>
              <span className="text-base font-semibold text-gray-900">{pricePreview.cost.toFixed(2)} €</span>
            </div>

            <button
              onClick={handleSubmit}
              disabled={submitting || (needsPhone && !isPlausiblePhone(phone))}
              className="w-full flex items-center justify-center space-x-2 px-4 py-2.5 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
            >
              {submitting ? (
                <span>Redirection vers le paiement...</span>
              ) : (
                <>
                  <CreditCard className="h-4 w-4" />
                  <span>Payer {pricePreview.cost.toFixed(2)} € et demander la livraison</span>
                </>
              )}
            </button>
            <p className="text-xs text-gray-400 text-center flex items-center justify-center gap-1">
              <Truck className="h-3 w-3" /> Paiement sécurisé par carte, via Stripe.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RequestDeliveryModal;
